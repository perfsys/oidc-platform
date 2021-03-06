
exports.up = function(knex, Promise) {
  if (process.env.OIDC_DB_ADAPTER === 'mysql') {
    return Promise.resolve();
  }

  return knex.schema.table('SIP_user_password_reset_token', table => {
    table.dropPrimary();
    table.dropForeign('user_id');
  }).then(() => {
    return knex.raw(
      `ALTER TABLE "SIP_user_password_reset_token" ALTER COLUMN user_id TYPE uuid USING user_id::uuid`
    );
  }).then(() => {
    return knex.raw(
      `ALTER TABLE "SIP_user_password_reset_token" ALTER COLUMN user_id SET NOT NULL`
    );
  }).then(() => {
    return knex.schema.alterTable('SIP_user_password_reset_token', table => {
      table.primary(['user_id', 'token']);
    });
  }).then(() => {
    return knex.schema.alterTable('SIP_user', table => {
      table.dropPrimary();
    });
  }).then(() => {
    return knex.raw(
      `ALTER TABLE "SIP_user" ALTER COLUMN id TYPE uuid USING id::uuid`
    );
  }).then(() => {
    return knex.schema.alterTable('SIP_user', table => {
      table.primary('id');
    });
  }).then(() => {
    return knex.schema.alterTable('SIP_user_password_reset_token', table => {
      table.foreign('user_id').references('id').inTable('SIP_user').onDelete('CASCADE').onUpdate('CASCADE');
    });
  });
};

exports.down = function(knex, Promise) {
  if (process.env.OIDC_DB_ADAPTER === 'mysql') {
    return Promise.resolve();
  }

  return knex.schema.alterTable('SIP_user_password_reset_token', table => {
    table.dropPrimary();
    table.dropForeign('user_id');
  }).then(() => {
    return knex.schema.alterTable('SIP_user_password_reset_token', table => {
      table.string('user_id', 36).notNull().alter();
      table.primary(['user_id', 'token']);
    });
  }).then(() => {
    return knex.schema.alterTable('SIP_user', table => {
      table.dropPrimary();
    });
  }).then(() => {
    return knex.schema.alterTable('SIP_user', table => {
      table.string('id', 36).notNull().alter().primary();
    });
  }).then(() => {
    return knex.schema.alterTable('SIP_user_password_reset_token', table => {
      table.foreign('user_id').references('id').inTable('SIP_user').onDelete('CASCADE').onUpdate('CASCADE');
    });
  });
};
