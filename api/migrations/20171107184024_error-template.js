
    // return knex.raw(`
    //   ALTER TABLE SIP_client_grant
    //     CHANGE grant_type grant_type ENUM('client_credentials', 'refresh_token', 'authorization_code', 'implicit', 'password')
    // `);

const mysqlUp = knex => knex.raw(`

`);

const up = knex => knex.raw(`
  ALTER TABLE "public"."SIP_template"
    DROP CONSTRAINT "SIP_template_name_check",
    ADD CONSTRAINT "SIP_template_name_check" CHECK (
      name = ANY (ARRAY[
        'forgot-password-email'::text,
        'invite-email'::text,
        'forgot-password-success'::text,
        'forgot-password'::text,
        'reset-password-success'::text,
        'reset-password'::text,
        'user-profile'::text,
        'user-registration'::text,
        'login'::text,
        'end_session'::text,
        'interaction'::text,
        'change-password'::text,
        'change-password-success-email'::text,
        'email-settings'::text,
        'email-verify-success'::text,
        'email-verify-email'::text,
        'change-email-verify-email'::text,
        'change-email-alert-email'::text,
        'error'::text
      ])
`);

if (process.env.OIDC_DB_ADAPTER === 'mysql') {
  exports.up = mysqlUp;
} else {
  exports.up = up;
}

exports.down = knex => { /* noop */ };
