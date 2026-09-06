param(
  [Parameter(Mandatory=$true)][string]$SupabaseCli,
  [string]$ProjectRef = 'ejzybbyjwtzbibrrwrli'
)
$ErrorActionPreference = 'Stop'
$appUrl = "https://$ProjectRef.supabase.co"
$testUser = [Guid]::NewGuid().ToString()
$testEmail = "student-miniapps-$testUser@example.invalid"
$testPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
$publicKeys = & $SupabaseCli projects api-keys --project-ref $ProjectRef --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not locate the public application key' }
$publicKey = ($publicKeys | Where-Object { $_.type -eq 'publishable' } | Select-Object -First 1).api_key
if (-not $publicKey) { throw 'Publishable key unavailable' }
Remove-Variable publicKeys
$testCreated = $false
$testHeaders = @{}
$testNote = 'Проверка сохранения заметки'
$evidence = [Collections.Generic.List[object]]::new()
$evidenceDirectory = Join-Path $PSScriptRoot '../artifacts/live'
$screensDirectory = Join-Path $evidenceDirectory 'screens'
New-Item -ItemType Directory -Path $screensDirectory -Force | Out-Null

function Invoke-TestQuery([string]$Query) {
  $result = & $SupabaseCli db query --linked --project-ref $ProjectRef $Query
  if ($LASTEXITCODE -ne 0) { throw 'Database verification failed' }
  return ($result | ConvertFrom-Json).rows
}

function Start-TestSession {
  $body = @{email=$testEmail;password=$testPassword} | ConvertTo-Json -Compress
  $session = Invoke-RestMethod -Uri "$appUrl/auth/v1/token?grant_type=password" -Method Post -Headers @{apikey=$publicKey} -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json'
  if (-not $session.access_token) { throw 'Test login failed' }
  return @{apikey=$publicKey;Authorization="Bearer $($session.access_token)"}
}

function Get-ScreenNodes([object]$Value) {
  if ($Value -is [Collections.IDictionary]) {
    ,$Value
    if ($Value.type -ne 'appIf') {
      foreach ($child in $Value.Values) { Get-ScreenNodes $child }
    }
  } elseif ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
    foreach ($child in $Value) { Get-ScreenNodes $child }
  }
}

function Assert-ScreenText([object]$Screen,[string]$Expected) {
  $found = @(Get-ScreenNodes $Screen | Where-Object { $_.type -eq 'appText' -and $_.data -eq $Expected })
  if (-not $Expected -or $found.Count -eq 0) { throw 'Expected screen content was not returned' }
}

function Invoke-TestProxy([string]$Slug,[string]$Path,[string]$Kind='screen',[hashtable]$Body=@{}) {
  $payload = @{organizationId='mirea';slug=$Slug;path=$Path;kind=$Kind;method='POST';body=$Body} | ConvertTo-Json -Depth 20 -Compress
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-WebRequest -Uri "$appUrl/functions/v1/miniapp-proxy" -Method Post -Headers $testHeaders -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -ContentType 'application/json' -TimeoutSec 30
  $timer.Stop()
  $size = [Text.Encoding]::UTF8.GetByteCount($response.Content)
  if ($response.StatusCode -ne 200 -or $size -gt 524288) { throw 'Proxy response contract failed' }
  $data = $response.Content | ConvertFrom-Json -AsHashtable -Depth 100
  if ($Kind -eq 'api' -and $data.ok -ne $true) { throw 'API operation was not confirmed' }
  if ($Kind -eq 'screen') {
    if (-not $data.type) { throw 'Screen was not returned' }
    if (@(Get-ScreenNodes $data | Where-Object { $_.type -eq 'appErrorState' }).Count -gt 0) {
      throw 'The service returned an error screen'
    }
  }
  $evidence.Add([pscustomobject]@{app=$Slug;path=$Path;kind=$Kind;status=[int]$response.StatusCode;bytes=$size;milliseconds=$timer.ElapsedMilliseconds})
  return $response.Content
}

function Save-TestScreen([string]$Slug,[string]$Path,[string]$Name) {
  $content = Invoke-TestProxy $Slug $Path
  [IO.File]::WriteAllText((Join-Path $screensDirectory $Name), $content, [Text.UTF8Encoding]::new($false))
  return ($content | ConvertFrom-Json -AsHashtable -Depth 100)
}

try {
  $catalog = @(Invoke-TestQuery "select count(*) as available from core.mini_apps where organization_id='mirea' and slug in ('learning-roadmap','student-discounts') and status='published';")[0]
  if ($catalog.available -ne 2) { throw 'Both mini apps must be published before live verification' }
  $plan = @(Invoke-TestQuery "select p.id, p.title, d->>'id' as discipline_id, d->>'name' as discipline_name from miniapp_learning_roadmap.plans p cross join lateral jsonb_array_elements(p.document->'disciplines') d where p.quality='complete' and coalesce(d->>'is_optional','false')='false' and coalesce(d->>'choice_group','')='' order by p.admission_year desc nulls last, p.id, d->>'id' limit 1;")[0]
  $discount = @(Invoke-TestQuery "select id from miniapp_student_discounts.offers where status='active' and retired_at is null and (content->>'valid_until' is null or (content->>'valid_until')::date >= (now() at time zone 'Europe/Moscow')::date) order by id limit 1;")[0]
  if (-not $plan.id -or -not $discount.id) { throw 'Live catalog is empty' }
  $creation = "begin; insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token,phone_change,phone_change_token,raw_app_meta_data,raw_user_meta_data) values('$testUser','00000000-0000-0000-0000-000000000000','authenticated','authenticated','$testEmail',extensions.crypt('$testPassword',extensions.gen_salt('bf')),now(),now(),now(),'','','','','','','','',jsonb_build_object('provider','email','providers',jsonb_build_array('email')),'{}'); insert into auth.identities(id,provider_id,user_id,identity_data,provider,created_at,updated_at) values(gen_random_uuid(),'$testUser','$testUser',jsonb_build_object('sub','$testUser','email','$testEmail','email_verified',true),'email',now(),now()); commit;"
  $testCreated = $true
  Invoke-TestQuery $creation | Out-Null
  $testHeaders = Start-TestSession
  Save-TestScreen 'learning-roadmap' '/catalog' 'learning-live-catalog.json' | Out-Null
  Invoke-TestProxy 'learning-roadmap' '/api/select' 'api' @{id=$plan.id} | Out-Null
  Invoke-TestProxy 'learning-roadmap' '/api/completed' 'api' @{id=$plan.id;discipline_id=$plan.discipline_id;completed=$true} | Out-Null
  Invoke-TestProxy 'learning-roadmap' '/api/note' 'api' @{id=$plan.id;discipline_id=$plan.discipline_id;note=$testNote} | Out-Null
  $discountHome = Save-TestScreen 'student-discounts' '/' 'discounts-live-home.json'
  if (@($discountHome.body.initial.listing.items).Count -eq 0) { throw 'The discounts home screen has no offers' }
  Invoke-TestProxy 'student-discounts' '/api/favorite' 'api' @{id=$discount.id;saved=$true} | Out-Null
  $testHeaders = Start-TestSession
  $learningHome = Save-TestScreen 'learning-roadmap' '/' 'learning-live-home.json'
  Assert-ScreenText $learningHome $plan.title
  $planScreen = Save-TestScreen 'learning-roadmap' ("/plan?id=" + [Uri]::EscapeDataString($plan.id)) 'learning-live-plan.json'
  Assert-ScreenText $planScreen $plan.title
  if (@(Get-ScreenNodes $planScreen | Where-Object { $_.type -eq 'appButton' -and $_.label -eq 'Это мой учебный план' }).Count -ne 1) {
    throw 'The selected plan was not restored in the new session'
  }
  $disciplineScreen = Save-TestScreen 'learning-roadmap' ("/discipline?id=" + [Uri]::EscapeDataString($plan.id) + '&discipline=' + [Uri]::EscapeDataString($plan.discipline_id)) 'learning-live-discipline.json'
  Assert-ScreenText $disciplineScreen $plan.discipline_name
  if ($disciplineScreen.initial.note -ne $testNote -or @(Get-ScreenNodes $disciplineScreen | Where-Object { $_.actionType -eq 'networkRequest' -and $_.body.id -eq $plan.id -and $_.body.discipline_id -eq $plan.discipline_id -and $_.body.completed -ceq $false }).Count -ne 1) {
    throw 'The saved note or completion was not restored in the discipline screen'
  }
  $favoritesScreen = Save-TestScreen 'student-discounts' '/favorites' 'discounts-live-favorites.json'
  if (@($favoritesScreen.body.initial.listing.items | Where-Object { $_.id -eq $discount.id -and $_.saved -ceq $true }).Count -ne 1) {
    throw 'The saved offer was not restored in the new session'
  }
  $suggestion = @{
    title='Проверка формы предложения';provider='Проверка каталога';benefit='Проверка условий для студентов'
    description='Временное предложение для проверки сохранения формы.';eligibility='Для проверки пользовательского сценария.'
    geography='Москва';category='culture';region='moscow';online=$false;source_url='https://www.mirea.ru/'
    instructions='Проверить заполненные поля предложения.';validity_note='Временная проверка формы.';coupon=''
  }
  Invoke-TestProxy 'student-discounts' '/api/suggest' 'api' $suggestion | Out-Null
  $createdSuggestion = @(Invoke-TestQuery "select id,status from miniapp_student_discounts.suggestions where user_id='$testUser';")
  if ($createdSuggestion.Count -ne 1 -or $createdSuggestion[0].status -ne 'pending') { throw 'The suggestion was not created' }
  $suggestion.id = $createdSuggestion[0].id
  $suggestion.title = 'Проверка редактирования предложения'
  Invoke-TestProxy 'student-discounts' '/api/suggest' 'api' $suggestion | Out-Null
  $editScreen = Save-TestScreen 'student-discounts' ("/suggest?id=" + $suggestion.id) 'discounts-live-suggestion-edit.json'
  if ($editScreen.body.initial.title -ne $suggestion.title -or $editScreen.body.initial.description -ne $suggestion.description) {
    throw 'The edited suggestion was not restored in its form'
  }
  Invoke-TestProxy 'student-discounts' '/api/withdraw' 'api' @{id=$suggestion.id} | Out-Null
  $suggestionsScreen = Save-TestScreen 'student-discounts' '/suggestions' 'discounts-live-suggestions.json'
  Assert-ScreenText $suggestionsScreen $suggestion.title
  if (@(Get-ScreenNodes $suggestionsScreen | Where-Object { $_.type -eq 'appBadge' -and $_.label -eq 'Отозвано' }).Count -ne 1) {
    throw 'The withdrawn suggestion was not reflected in its screen'
  }
  $state = @(Invoke-TestQuery "select (select count(*) from miniapp_learning_roadmap.progress where user_id='$testUser' and completed and note='$testNote') as progress, (select count(*) from miniapp_student_discounts.favorites where user_id='$testUser') as favorites, (select count(*) from miniapp_student_discounts.suggestions where user_id='$testUser' and status='withdrawn') as withdrawn;")[0]
  if ($state.progress -ne 1 -or $state.favorites -ne 1) { throw 'State did not survive a fresh session' }
  if ($state.withdrawn -ne 1) { throw 'The suggestion was not withdrawn' }
  foreach ($slug in @('learning-roadmap','student-discounts')) {
    $unauthorized = Invoke-WebRequest -Uri "$appUrl/functions/v1/miniapp-svc-$slug" -Method Post -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck
    if ($unauthorized.StatusCode -ne 403) { throw 'Direct service access was not rejected' }
  }
} finally {
  if ($testCreated) {
    if ($testHeaders.Authorization) {
      try {
        Invoke-RestMethod -Uri "$appUrl/auth/v1/logout?scope=global" -Method Post -Headers $testHeaders | Out-Null
      } catch {
        Write-Verbose 'Test session logout was unavailable; the test account will be removed'
      }
    }
    Invoke-TestQuery "delete from auth.users where id='$testUser' and email='$testEmail';" | Out-Null
    $remaining = @(Invoke-TestQuery "select (select count(*) from auth.users where id='$testUser') + (select count(*) from auth.identities where user_id='$testUser') + (select count(*) from miniapp_learning_roadmap.progress where user_id='$testUser') + (select count(*) from miniapp_student_discounts.favorites where user_id='$testUser') + (select count(*) from miniapp_student_discounts.suggestions where user_id='$testUser') as records;")[0]
    if ($remaining.records -ne 0) { throw 'The temporary verification account was not fully removed' }
  }
  $testHeaders = @{}
  $testPassword = $null
  $publicKey = $null
}
$evidence | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidenceDirectory 'report.json') -Encoding utf8
$evidence | ConvertTo-Json -Depth 5

