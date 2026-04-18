-- BFSI tracker signature pack — seeded 2026-04-18.
--
-- Seeds admin.tracker_signature_catalogue with 16 tracker signatures that
-- are commonly embedded on Indian BFSI websites (lenders, NBFCs, fintechs,
-- insurance portals). Every pattern below was verified against the
-- vendor's own integration documentation on 2026-04-18 — no guessed
-- hostnames. Vendors whose public docs did not expose a concrete browser
-- JS script URL (HyperVerge HyperKYC, IDfy, Signzy, Karza, CIBIL / bureau
-- widgets, Verloop, Juspay HyperCheckout) were intentionally excluded —
-- they integrate server-to-server or via iframes with dynamic hosts, and
-- static script_src detection would produce false negatives.
--
-- Sources (accessed 2026-04-18):
--   Razorpay      — razorpay.com/docs/payments/payment-gateway/web-integration/standard/
--   PayU India    — devguide.payu.in (jssdk.payu.in bundle)
--   CCAvenue      — secure.ccavenue.com transaction URL (hosted checkout)
--   Paytm         — business.paytm.com/docs/js-checkout/getting-started/
--   PhonePe       — developer.phonepe.com/payment-gateway (mercury checkout bundle)
--   BillDesk      — docs.billdesk.io (pay.billdesk.com/jssdk + services.billdesk.com checkout widget)
--   Cashfree      — cashfree.com/docs (sdk.cashfree.com v3)
--   Digio         — documentation.digio.in/sdk/web/web/
--   Haptik        — docs.haptik.ai/web-sdk/how-to-deploy-a-bot-on-my-website
--   MoEngage      — docs.moengage.com (cdn.moengage.com web SDK loader)
--   CleverTap     — developer.clevertap.com (clevertap.com + d2r1yp CDN)
--   WebEngage     — docs.webengage.com (cdn.webengage.com)
--   Freshchat     — support.freshchat.com (wchat.freshchat.com)
--   Segment       — segment.com/docs (cdn.segment.com/analytics.js)
--   Google Tag Manager — developers.google.com/tag-manager (googletagmanager.com/gtm.js)
--
-- Idempotent: on conflict (signature_code) do nothing.
--
-- Depends on: 20260417000004_admin_tracker_signatures.sql
--             at least one row in admin.admin_users (bootstrap-admin.ts)

do $$
declare
  v_admin_id uuid;
  v_inserted_before int;
  v_inserted_after  int;
begin
  select id into v_admin_id
    from admin.admin_users
   order by created_at asc
   limit 1;

  if v_admin_id is null then
    raise exception
      'no admin.admin_users row — run scripts/bootstrap-admin.ts first';
  end if;

  select count(*) into v_inserted_before from admin.tracker_signature_catalogue;

  insert into admin.tracker_signature_catalogue
    (signature_code, display_name, vendor, signature_type, pattern, category, severity, status, notes, created_by)
  values

  -- Payment gateways — functional, info severity (customer needs these to run the business)
  ('razorpay_checkout',
   'Razorpay Standard Checkout',
   'Razorpay',
   'script_src',
   'checkout\.razorpay\.com/v\d+/checkout\.js',
   'functional', 'info', 'active',
   'source: razorpay.com/docs/payments/payment-gateway/web-integration/standard/ (2026-04-18)',
   v_admin_id),

  ('payu_india_jssdk',
   'PayU India JS SDK',
   'PayU',
   'script_src',
   'jssdk\.payu\.in',
   'functional', 'info', 'active',
   'source: devguide.payu.in web-sdk (2026-04-18)',
   v_admin_id),

  ('ccavenue_transaction',
   'CCAvenue Hosted Transaction Page',
   'CCAvenue',
   'resource_url',
   'secure\.ccavenue\.com/transaction/transaction\.do',
   'functional', 'info', 'active',
   'source: ccavenue.com merchant integration kit — hosted iframe (2026-04-18)',
   v_admin_id),

  ('paytm_jscheckout',
   'Paytm JS Checkout',
   'Paytm',
   'script_src',
   'securegw(?:-stage)?\.paytm\.in/merchantpgpui/checkoutjs/merchants/',
   'functional', 'info', 'active',
   'source: business.paytm.com/docs/js-checkout/getting-started/ (2026-04-18)',
   v_admin_id),

  ('phonepe_checkout',
   'PhonePe Standard Checkout',
   'PhonePe',
   'script_src',
   'mercury\.phonepe\.com/web/bundle/checkout\.js',
   'functional', 'info', 'active',
   'source: developer.phonepe.com/payment-gateway (2026-04-18)',
   v_admin_id),

  ('billdesk_jssdk',
   'BillDesk Web SDK',
   'BillDesk',
   'script_src',
   'pay\.billdesk\.com/jssdk/',
   'functional', 'info', 'active',
   'source: docs.billdesk.io one-time-payments web-sdk (2026-04-18)',
   v_admin_id),

  ('billdesk_checkout_widget',
   'BillDesk Checkout Widget (legacy)',
   'BillDesk',
   'script_src',
   'services\.billdesk\.com/checkout-widget/src/app\.bundle\.js',
   'functional', 'info', 'active',
   'source: docs.billdesk.io legacy checkout widget (2026-04-18)',
   v_admin_id),

  ('cashfree_sdk_v3',
   'Cashfree Payments SDK v3',
   'Cashfree',
   'script_src',
   'sdk\.cashfree\.com/js/v\d+/cashfree(?:\.sandbox|\.prod)?\.js',
   'functional', 'info', 'active',
   'source: cashfree.com/docs web checkout v3 (2026-04-18)',
   v_admin_id),

  -- KYC / identity — functional, info severity
  ('digio_web_sdk',
   'Digio Web SDK (KYC / eSign)',
   'Digio',
   'script_src',
   '(?:app|ext)\.digio\.in/sdk/v\d+/digio\.js',
   'functional', 'info', 'active',
   'source: documentation.digio.in/sdk/web/web/ (2026-04-18)',
   v_admin_id),

  -- Chat / support — functional but gate-behind-consent (warn)
  ('haptik_web_xdk',
   'Haptik JavaScript XDK',
   'Jio Haptik',
   'script_src',
   'toolassets\.haptikapi\.com/platform/javascript-xdk/production/loader\.js',
   'functional', 'warn', 'active',
   'source: docs.haptik.ai/web-sdk/how-to-deploy-a-bot-on-my-website (2026-04-18)',
   v_admin_id),

  ('freshchat_widget',
   'Freshchat Web Widget',
   'Freshworks',
   'script_src',
   'wchat\.(?:in\.)?freshchat\.com',
   'functional', 'warn', 'active',
   'source: support.freshchat.com web-widget install (2026-04-18)',
   v_admin_id),

  -- Marketing automation / engagement analytics — analytics, warn
  ('moengage_web_sdk',
   'MoEngage Web SDK',
   'MoEngage',
   'script_src',
   'cdn\.moengage\.com',
   'analytics', 'warn', 'active',
   'source: docs.moengage.com web-sdk (2026-04-18)',
   v_admin_id),

  ('clevertap_web_sdk',
   'CleverTap Web SDK',
   'CleverTap',
   'script_src',
   '(?:static\.)?clevertap\.com/js/clevertap(?:\.min)?\.js',
   'analytics', 'warn', 'active',
   'source: developer.clevertap.com web-sdk (2026-04-18)',
   v_admin_id),

  ('webengage_web_sdk',
   'WebEngage Web SDK',
   'WebEngage',
   'script_src',
   'cdn\.webengage\.com',
   'analytics', 'warn', 'active',
   'source: docs.webengage.com web-install (2026-04-18)',
   v_admin_id),

  ('segment_analytics',
   'Segment analytics.js',
   'Segment (Twilio)',
   'script_src',
   'cdn\.segment\.com/analytics\.js',
   'analytics', 'warn', 'active',
   'source: segment.com/docs/connections/sources/catalog/libraries/website/javascript/ (2026-04-18)',
   v_admin_id),

  -- Tag manager wrapper — other, warn (what it loads is unknown at scan time)
  ('google_tag_manager',
   'Google Tag Manager',
   'Google',
   'script_src',
   'googletagmanager\.com/gtm\.js',
   'other', 'warn', 'active',
   'source: developers.google.com/tag-manager/quickstart (2026-04-18)',
   v_admin_id)

  on conflict (signature_code) do nothing;

  select count(*) into v_inserted_after from admin.tracker_signature_catalogue;

  raise notice 'BFSI seed: catalogue rows before=% after=% (delta=%)',
    v_inserted_before, v_inserted_after, v_inserted_after - v_inserted_before;
end $$;

-- Verification:
--   select count(*) from admin.tracker_signature_catalogue
--     where status = 'active'
--       and signature_code in (
--         'razorpay_checkout','payu_india_jssdk','ccavenue_transaction',
--         'paytm_jscheckout','phonepe_checkout','billdesk_jssdk',
--         'billdesk_checkout_widget','cashfree_sdk_v3','digio_web_sdk',
--         'haptik_web_xdk','freshchat_widget','moengage_web_sdk',
--         'clevertap_web_sdk','webengage_web_sdk','segment_analytics',
--         'google_tag_manager'
--       ); → 16
