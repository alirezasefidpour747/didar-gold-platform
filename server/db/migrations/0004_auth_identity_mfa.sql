CREATE TABLE IF NOT EXISTS "auth_external_identities" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "party_id" varchar(128) NOT NULL REFERENCES "k01_persons"("id") ON DELETE CASCADE,
  "provider" varchar(32) NOT NULL,
  "provider_subject" varchar(255) NOT NULL,
  "email" varchar(255),
  "email_verified" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_login_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_auth_external_provider_subject" ON "auth_external_identities" ("provider","provider_subject");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_auth_external_party_provider" ON "auth_external_identities" ("party_id","provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_external_party" ON "auth_external_identities" ("party_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_oauth_states" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "state_hash" varchar(128) NOT NULL,
  "provider" varchar(32) NOT NULL,
  "code_verifier" varchar(255) NOT NULL,
  "return_url" text NOT NULL,
  "party_id" varchar(128) REFERENCES "k01_persons"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_auth_oauth_state_hash" ON "auth_oauth_states" ("state_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_oauth_state_expiry" ON "auth_oauth_states" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_oauth_tickets" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "ticket_hash" varchar(128) NOT NULL,
  "party_id" varchar(128) NOT NULL REFERENCES "k01_persons"("id") ON DELETE CASCADE,
  "provider" varchar(32) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_auth_oauth_ticket_hash" ON "auth_oauth_tickets" ("ticket_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_oauth_ticket_party" ON "auth_oauth_tickets" ("party_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_totp_factors" (
  "party_id" varchar(128) PRIMARY KEY NOT NULL REFERENCES "k01_persons"("id") ON DELETE CASCADE,
  "secret_ciphertext" text NOT NULL,
  "secret_iv" varchar(64) NOT NULL,
  "secret_auth_tag" varchar(64) NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'pending',
  "confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_totp_status" ON "auth_totp_factors" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_recovery_codes" (
  "id" varchar(128) PRIMARY KEY NOT NULL,
  "party_id" varchar(128) NOT NULL REFERENCES "k01_persons"("id") ON DELETE CASCADE,
  "code_hash" varchar(128) NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auth_recovery_party" ON "auth_recovery_codes" ("party_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_auth_recovery_party_code" ON "auth_recovery_codes" ("party_id","code_hash");
