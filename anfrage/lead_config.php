<?php
declare(strict_types=1);

// Supabase
const SUPABASE_URL = 'https://uledkuegmaritmsjejlm.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZWRrdWVnbWFyaXRtc2plamxtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTU4OTkyOSwiZXhwIjoyMDg3MTY1OTI5fQ.YXRbn9JAmKWxxMNTjRbLnT47FbNJ40juOr0XCNVjwWU';

// Company
const COMPANY_ID = '0632a3c1-2734-4303-9341-f1b2db7f977a';

// Mail (optional overrides)
const MAIL_FROM = 'info@grapiy.show';          // ex: 'no-reply@domeniu.de'
const MAIL_FROM_NAME = 'AnfrageBox';
const OWNER_EMAIL_OVERRIDE = ''; // dacă e gol, ia din company_settings.email

// Anti-spam optional (dacă nu folosești, lasă gol)
const TURNSTILE_SECRET = '0x4AAAAAACle13sa9kUeLRUgGJq03ODNwM8'; // Cloudflare Turnstile secret (server-side), opțional