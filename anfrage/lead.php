<?php
declare(strict_types=1);

require __DIR__ . '/lead_config.php';

header('Content-Type: application/json; charset=utf-8');

function respond(int $code, array $data): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function log_error(string $msg): void {
  $line = '[' . date('c') . '] ' . $msg . "\n";
  @file_put_contents(__DIR__ . '/lead_errors.log', $line, FILE_APPEND);
}

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || trim($raw) === '') return [];
  $j = json_decode($raw, true);
  return is_array($j) ? $j : [];
}

function s($v): string {
  return trim((string)($v ?? ''));
}

function pick(array $a, array $keys, $default = null) {
  foreach ($keys as $k) {
    if (array_key_exists($k, $a) && $a[$k] !== null) return $a[$k];
  }
  return $default;
}

function is_uuid(string $v): bool {
  return (bool)preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $v);
}

function h($s): string {
  return htmlspecialchars((string)($s ?? ''), ENT_QUOTES, 'UTF-8');
}

function supabase_request(string $method, string $path, array $query = [], $body = null): array {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return ['ok' => false, 'status' => 500, 'error' => 'Missing SUPABASE config'];
  }

  $url = rtrim(SUPABASE_URL, '/') . '/rest/v1/' . ltrim($path, '/');
  if ($query) $url .= '?' . http_build_query($query);

  $ch = curl_init($url);
  if (!$ch) return ['ok' => false, 'status' => 500, 'error' => 'curl_init failed'];

  $headers = [
    'apikey: ' . SUPABASE_SERVICE_ROLE_KEY,
    'Authorization: Bearer ' . SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type: application/json',
    'Accept: application/json',
  ];

  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
  curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
  curl_setopt($ch, CURLOPT_TIMEOUT, 20);

  if ($body !== null) {
    $json = json_encode($body, JSON_UNESCAPED_UNICODE);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $json);
  }

  $resp = curl_exec($ch);
  $err  = curl_error($ch);
  $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  if ($resp === false) return ['ok' => false, 'status' => 500, 'error' => 'curl: ' . $err];

  $data = json_decode($resp, true);
  if ($code >= 200 && $code < 300) return ['ok' => true, 'status' => $code, 'data' => $data];

  return ['ok' => false, 'status' => $code, 'error' => $resp, 'data' => $data];
}

function generate_portal_token(): string {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  $token = '';
  for ($i = 0; $i < 32; $i++) $token .= $chars[random_int(0, strlen($chars) - 1)];
  return $token;
}

function send_mail_html(string $to, string $subject, string $html, string $replyTo = ''): bool {
  $to = trim($to);
  if ($to === '') return false;

  $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
  $fromEmail = MAIL_FROM !== '' ? MAIL_FROM : ('no-reply@' . preg_replace('/:\d+$/', '', $host));
  $fromName = MAIL_FROM_NAME ?: 'AnfrageBox';

  $headers = [];
  $headers[] = 'MIME-Version: 1.0';
  $headers[] = 'Content-Type: text/html; charset=UTF-8';
  $headers[] = 'From: ' . mb_encode_mimeheader($fromName) . ' <' . $fromEmail . '>';
  if ($replyTo !== '') $headers[] = 'Reply-To: ' . $replyTo;

  return @mail($to, mb_encode_mimeheader($subject), $html, implode("\r\n", $headers));
}

function verify_turnstile(string $token): bool {
  if (TURNSTILE_SECRET === '') return true;
  if ($token === '') return false;

  $ch = curl_init('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  if (!$ch) return false;

  $post = http_build_query([
    'secret' => TURNSTILE_SECRET,
    'response' => $token,
    'remoteip' => ($_SERVER['REMOTE_ADDR'] ?? ''),
  ]);

  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, $post);
  curl_setopt($ch, CURLOPT_TIMEOUT, 15);

  $resp = curl_exec($ch);
  curl_close($ch);

  $j = json_decode((string)$resp, true);
  return is_array($j) && !empty($j['success']);
}

try {
  if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
  }

  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'error' => 'Method not allowed']);
  }

  if (!is_uuid(COMPANY_ID)) {
    respond(500, ['ok' => false, 'error' => 'Invalid COMPANY_ID in config']);
  }

  $payload = read_json_body();

  $turnstileToken = s(pick($payload, ['turnstile_token', 'cf_turnstile_token', 'turnstile']));
  if (!verify_turnstile($turnstileToken)) {
    respond(400, ['ok' => false, 'error' => 'Captcha failed']);
  }

  $customer = is_array(pick($payload, ['customer'], [])) ? $payload['customer'] : [];
  $name  = s(pick($payload, ['customer_name', 'name'])) ?: s(pick($customer, ['name']));
  $email = s(pick($payload, ['customer_email', 'email'])) ?: s(pick($customer, ['email']));
  $phone = s(pick($payload, ['customer_phone', 'phone'])) ?: s(pick($customer, ['phone']));

  $privacyOk = (bool)pick($payload, ['privacy_ok', 'privacyOk'], false);
  if (!$privacyOk) {
    respond(400, ['ok' => false, 'error' => 'privacy_ok is required']);
  }

  if ($name === '' && $email === '' && $phone === '') {
    respond(400, ['ok' => false, 'error' => 'Missing contact data']);
  }

  $pickup_address  = is_array(pick($payload, ['pickup_address'], [])) ? $payload['pickup_address'] : [];
  $pickup_details  = is_array(pick($payload, ['pickup_details'], [])) ? $payload['pickup_details'] : [];
  $dropoff_address = is_array(pick($payload, ['dropoff_address'], [])) ? $payload['dropoff_address'] : [];
  $dropoff_details = is_array(pick($payload, ['dropoff_details'], [])) ? $payload['dropoff_details'] : [];

  $from = [
    'street' => s(pick($pickup_address, ['street','strasse'])),
    'number' => s(pick($pickup_address, ['number','nr'])),
    'zip'    => s(pick($pickup_address, ['zip','plz'])),
    'city'   => s(pick($pickup_address, ['city','ort'])),
    'country'=> s(pick($pickup_address, ['country'])) ?: 'Deutschland',
    'floor'  => s(pick($pickup_details, ['floor'])),
    'elevator' => pick($pickup_details, ['elevator'], null),
  ];

  $to = [
    'street' => s(pick($dropoff_address, ['street','strasse'])),
    'number' => s(pick($dropoff_address, ['number','nr'])),
    'zip'    => s(pick($dropoff_address, ['zip','plz'])),
    'city'   => s(pick($dropoff_address, ['city','ort'])),
    'country'=> s(pick($dropoff_address, ['country'])) ?: 'Deutschland',
    'floor'  => s(pick($dropoff_details, ['floor'])),
    'elevator' => pick($dropoff_details, ['elevator'], null),
  ];

  $moveDate = s(pick($payload, ['move_date','moveDate']));
  $moveDate = $moveDate !== '' ? $moveDate : null;

  $selected_rooms = pick($payload, ['selected_rooms'], null);
  $room_items = pick($payload, ['room_items'], null);
  $room_item_quantities = pick($payload, ['room_item_quantities'], null);
  $assembly_request = pick($payload, ['assembly_request'], null);
  $box_request = pick($payload, ['box_request'], null);
  $summary_text = s(pick($payload, ['summary_text','notes','customer_note']));

  $leadRow = [
    'company_id' => COMPANY_ID,
    'source' => 'wizard',
    'status' => 'Neu',

    'customer_name' => $name !== '' ? $name : null,
    'customer_email' => $email !== '' ? $email : null,
    'customer_phone' => $phone !== '' ? $phone : null,

    'move_date' => $moveDate,

    'from_street' => $from['street'] !== '' ? $from['street'] : null,
    'from_no'     => $from['number'] !== '' ? $from['number'] : null,
    'from_zip'    => $from['zip'] !== '' ? $from['zip'] : null,
    'from_city'   => $from['city'] !== '' ? $from['city'] : null,
    'from_country'=> $from['country'] !== '' ? $from['country'] : 'Deutschland',
    'from_floor'  => $from['floor'] !== '' ? $from['floor'] : null,
    'from_lift'   => is_bool($from['elevator']) ? $from['elevator'] : false,

    'to_street' => $to['street'] !== '' ? $to['street'] : null,
    'to_no'     => $to['number'] !== '' ? $to['number'] : null,
    'to_zip'    => $to['zip'] !== '' ? $to['zip'] : null,
    'to_city'   => $to['city'] !== '' ? $to['city'] : null,
    'to_country'=> $to['country'] !== '' ? $to['country'] : 'Deutschland',
    'to_floor'  => $to['floor'] !== '' ? $to['floor'] : null,
    'to_lift'   => is_bool($to['elevator']) ? $to['elevator'] : false,

    'privacy_ok' => true,

    'pickup_address' => $pickup_address ?: null,
    'pickup_details' => $pickup_details ?: null,
    'dropoff_address' => $dropoff_address ?: null,
    'dropoff_details' => $dropoff_details ?: null,
    'selected_rooms' => $selected_rooms,
    'room_items' => $room_items,
    'room_item_quantities' => $room_item_quantities,
    'assembly_request' => $assembly_request,
    'box_request' => $box_request,
    'summary_text' => $summary_text !== '' ? $summary_text : null,

    'payload' => $payload,
    'raw_payload' => $payload,
  ];

  $ins = supabase_request('POST', 'leads', ['select' => 'id'], $leadRow + ['__prefer' => null]);
  if (!$ins['ok']) {
    log_error('Insert leads failed: HTTP ' . $ins['status'] . ' ' . ($ins['error'] ?? ''));
    respond(500, ['ok' => false, 'error' => 'Insert failed', 'detail' => $ins['status']]);
  }

  $inserted = $ins['data'];
  $leadId = is_array($inserted) && isset($inserted[0]['id']) ? (string)$inserted[0]['id'] : '';

  if ($leadId === '') {
    respond(500, ['ok' => false, 'error' => 'Insert ok but id missing']);
  }

  // ── Get company info ──
  $ownerEmail = OWNER_EMAIL_OVERRIDE;
  $companyName = 'Umzug Transporte 84';
  $companyPhone = '';
  $companyWebsite = '';
  $companyEmailAddr = '';

  $cs = supabase_request('GET', 'company_settings', [
    'company_id' => 'eq.' . COMPANY_ID,
    'select' => 'company_name,email,phone,website'
  ]);

  if ($cs['ok'] && is_array($cs['data']) && isset($cs['data'][0])) {
    $row = $cs['data'][0];
    $companyName = s($row['company_name'] ?? $companyName) ?: $companyName;
    $companyPhone = s($row['phone'] ?? '');
    $companyWebsite = s($row['website'] ?? '');
    $companyEmailAddr = s($row['email'] ?? '');
    if ($ownerEmail === '') $ownerEmail = $companyEmailAddr;
  }

  // ── Generate portal token ──
  $portalToken = generate_portal_token();
  $portalUrl = '';

  $ptIns = supabase_request('POST', 'portal_tokens', ['select' => 'id'], [
    'company_id' => COMPANY_ID,
    'lead_id' => $leadId,
    'token' => $portalToken,
  ]);

  if ($ptIns['ok']) {
    $siteUrl = 'https://' . ($_SERVER['HTTP_HOST'] ?? 'anfragebox.de');
    $portalUrl = $siteUrl . '/portal/' . $portalToken;
  } else {
    log_error('Portal token insert failed for lead ' . $leadId);
  }

  // ── Email to Owner ──
  $route = trim(($from['zip'] . ' ' . $from['city']) . ' → ' . ($to['zip'] . ' ' . $to['city']));
  $subjectOwner = 'Neue Umzugsanfrage • ' . $companyName;

  $htmlOwner = '
  <div style="font-family:Arial,sans-serif;max-width:720px">
    <h2 style="margin:0 0 8px 0">Neue Umzugsanfrage</h2>
    <p style="margin:0 0 12px 0;color:#555">Lead-ID: <b>' . h($leadId) . '</b></p>

    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:12px 0">
      <div><b>Kunde</b></div>
      <div>Name: ' . h($name ?: '-') . '</div>
      <div>Telefon: ' . h($phone ?: '-') . '</div>
      <div>E-Mail: ' . h($email ?: '-') . '</div>
      <div>Termin: ' . h($moveDate ?: '-') . '</div>
    </div>

    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:12px 0">
      <div><b>Route</b></div>
      <div>' . h($route ?: '-') . '</div>
      <div style="margin-top:8px">Von: ' . h(trim($from['street'].' '.$from['number'].', '.$from['zip'].' '.$from['city'])) . '</div>
      <div>Nach: ' . h(trim($to['street'].' '.$to['number'].', '.$to['zip'].' '.$to['city'])) . '</div>
    </div>

    ' . ($portalUrl !== '' ? '<div style="border:1px solid #d1fae5;border-radius:12px;padding:12px;margin:12px 0;background:#f0fdf4"><div><b>Kundenportal</b></div><div style="margin-top:4px"><a href="' . h($portalUrl) . '" style="color:#047857">' . h($portalUrl) . '</a></div><div style="margin-top:4px;color:#6b7280;font-size:13px">Kunde wurde gebeten, Fotos hochzuladen.</div></div>' : '') . '

    ' . ($summary_text !== '' ? '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;margin:12px 0"><b>Notiz</b><div style="margin-top:8px;white-space:pre-line">' . h($summary_text) . '</div></div>' : '') . '

    <p style="color:#777;margin-top:14px">Quelle: wizard. Company: ' . h(COMPANY_ID) . '</p>
  </div>';

  $replyTo = $email !== '' ? $email : '';
  send_mail_html($ownerEmail, $subjectOwner, $htmlOwner, $replyTo);

  // ── Email to Client (with portal link) ──
  if ($email !== '') {
    $subjectClient = 'Bestätigung Ihrer Umzugsanfrage';

    $portalBlock = '';
    if ($portalUrl !== '') {
      $portalBlock = '
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:20px 0;">
        <div style="font-size:15px;font-weight:700;color:#065f46;margin:0 0 8px;">📸 Bitte laden Sie Fotos hoch</div>
        <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px;">
          Damit wir Ihnen einen genauen Preis berechnen können, benötigen wir Fotos von den Gegenständen, die transportiert werden sollen. Fotografieren Sie jeden Raum und größere Möbelstücke.
        </div>
        <a href="' . h($portalUrl) . '" style="display:inline-block;padding:12px 28px;background:#047857;color:#ffffff;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
          Fotos jetzt hochladen →
        </a>
      </div>';
    }

    $htmlClient = '
    <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto;">
      <div style="padding:24px;">
        <div style="height:4px;background:#047857;border-radius:999px;margin-bottom:24px;"></div>

        <div style="font-size:12px;font-weight:700;color:#047857;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 4px;">Bestätigung</div>
        <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 16px;line-height:1.2;">Ihre Umzugsanfrage</h1>

        <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 4px;">
          Guten Tag ' . h($name ?: 'Kunde') . ',
        </p>
        <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 20px;">
          vielen Dank für Ihre Anfrage. Wir haben Ihre Umzugsanfrage erhalten.
        </p>

        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:0 0 16px;">
          <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">Zusammenfassung</div>
          <div style="margin-top:10px;font-size:14px;color:#111827;line-height:1.7;">
            <div><b>Name:</b> ' . h($name ?: '-') . '</div>
            <div><b>Route:</b> ' . h($route ?: '-') . '</div>
            <div><b>Termin:</b> ' . h($moveDate ?: 'Nach Vereinbarung') . '</div>
          </div>
        </div>

        ' . $portalBlock . '

        <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:16px 0 0;">
          Unser Team prüft Ihre Angaben und meldet sich in der Regel innerhalb von 24 Stunden telefonisch oder per E-Mail.
        </p>

        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:20px 0;">
          <div style="font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.06em;">Kontakt</div>
          <div style="margin-top:8px;font-size:14px;color:#111827;line-height:1.7;">
            <div>' . h($companyName) . '</div>
            ' . ($companyPhone !== '' ? '<div>Telefon: ' . h($companyPhone) . '</div>' : '') . '
            ' . ($companyEmailAddr !== '' ? '<div>E-Mail: <a href="mailto:' . h($companyEmailAddr) . '" style="color:#047857;">' . h($companyEmailAddr) . '</a></div>' : '') . '
            ' . ($companyWebsite !== '' ? '<div>Website: <a href="' . h($companyWebsite) . '" style="color:#047857;">' . h($companyWebsite) . '</a></div>' : '') . '
          </div>
        </div>

        <p style="font-size:14px;color:#374151;margin:0;">Mit freundlichen Grüßen<br>Ihr Team von ' . h($companyName) . '</p>

        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
          <p style="font-size:11px;color:#9ca3af;margin:0;">
            Bereitgestellt von <a href="https://anfragebox.de" style="color:#047857;">AnfrageBox</a>
          </p>
        </div>
      </div>
    </div>';

    send_mail_html($email, $subjectClient, $htmlClient, $ownerEmail);
  }

  respond(200, ['ok' => true, 'lead_id' => $leadId, 'portal_url' => $portalUrl]);

} catch (Throwable $e) {
  log_error('Exception: ' . $e->getMessage());
  respond(500, ['ok' => false, 'error' => 'Server error']);
}