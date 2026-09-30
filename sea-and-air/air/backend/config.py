"""Every business-tunable value used by pricing, quoting, and job numbering lives
here as a single named setting, never as a literal inline where it is used.
Changing a markup, a validity window, or a volumetric factor is an environment
change, not a code change.

Security-sensitive defaults (JWT signing key, ops bootstrap password) are
dev-only placeholders. `Settings.assert_production_ready` refuses to let the
app start with any of them still in place when `ENVIRONMENT=production` --
failing closed at boot rather than silently running a production deployment
with a publicly-known signing key, which would let anyone forge a token for
any account.
"""

from functools import lru_cache
from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict

# Values that are safe for local development and catastrophic in production.
# Kept as named constants so the check below and the defaults can never drift.
DEV_JWT_SECRET = "dev-only-insecure-secret-change-me"
DEV_OPS_PASSWORD = "ChangeMe123!"


class InsecureProductionConfig(RuntimeError):
    """Raised at startup when production is configured with a dev-only secret."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # "production" turns on the startup safety checks below and makes
    # `secure_cookies`/HSTS behaviour explicit. Anything else is treated as a
    # development environment.
    environment: str = "development"

    # PostgreSQL in production. Tests override this with a file-backed SQLite URL
    # via the get_settings dependency override in tests/conftest.py — nothing in
    # application code assumes which database is behind DATABASE_URL.
    database_url: str = "postgresql+psycopg://raaziq:raaziq@localhost:5432/raaziq"

    # Uniform markup applied to every applicable quote line item.
    #
    # This uniform markup across all charge kinds is an MVP simplification. A
    # future pricing model should support markup rules per charge kind.
    default_markup_percent: Decimal = Decimal("20")

    # How many days a freshly generated quote stays valid before lazy-expiry
    # treats it as expired.
    quote_validity_days: int = 14

    # Volumetric (dimensional) weight factors, expressed as kg per CBM. Mode-
    # specific because air, sea, and road carriers price dimensional weight
    # differently.
    volumetric_factor_air: Decimal = Decimal("167")
    volumetric_factor_sea: Decimal = Decimal("1000")
    volumetric_factor_road: Decimal = Decimal("333")

    # Job number format: {prefix}-{year}-{sequence zero-padded to `padding`}.
    job_number_prefix: str = "RAZ"
    job_number_padding: int = 5

    # Invoice number format: {prefix}-{year}-{sequence zero-padded to `padding`}.
    invoice_number_prefix: str = "INV"
    invoice_number_padding: int = 5

    # Browser origins allowed to call the API.
    cors_origins: str = "http://localhost:5173"

    # Signs worker/customer/ops login tokens (utils.security). Override in
    # production -- this default is only safe for local development, and
    # `assert_production_ready` refuses to boot production with it.
    jwt_secret_key: str = DEV_JWT_SECRET
    jwt_expiry_minutes: int = 12 * 60

    # Failed-login throttling (utils.rate_limit). Applied per
    # username+client-IP so one attacker can't lock out a real user by
    # guessing at their account, and one IP can't spray many accounts.
    login_max_attempts: int = 10
    login_lockout_seconds: int = 900

    # Bootstrap credential for the single seeded OpsUser (database/seeds/seed.py).
    # This is a TEMPORARY DEVELOPMENT CREDENTIAL, not a permanent one: it is only
    # ever used to create the account once (re-seeding never resets an existing
    # admin's password -- see _get_or_create), and it must be changed via
    # POST /ops/change-password before any real deployment. Override both via
    # the environment for anything beyond local dev.
    ops_admin_username: str = "admin"
    ops_admin_password: str = DEV_OPS_PASSWORD

    # Emails a rendered quote/invoice PDF to the customer on file
    # (services.email). Optional and feature-gated, deliberately NOT checked
    # by assert_production_ready below -- a deployment with no key configured
    # still boots and serves every other route fine; only the "Send by
    # email" action itself fails with a clear EmailNotConfigured error.
    resend_api_key: str | None = None
    resend_from_email: str = "Raaziq International <onboarding@resend.dev>"
    # Gmail requires a sender account and its app password; recipients are
    # separate, editable per issuing company. No credentials go to the UI.
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    notification_email: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    def assert_production_ready(self) -> None:
        """Fail closed at startup rather than serve traffic with a known
        secret. A publicly-known `jwt_secret_key` is a full authentication
        bypass -- anyone can mint a valid token for any ops user, worker, or
        customer -- so this is a hard boot failure, not a warning.
        """
        if not self.is_production:
            return

        problems: list[str] = []
        if self.jwt_secret_key == DEV_JWT_SECRET:
            problems.append("JWT_SECRET_KEY is still the public development default")
        if len(self.jwt_secret_key) < 32:
            problems.append("JWT_SECRET_KEY is shorter than 32 characters")
        if self.ops_admin_password == DEV_OPS_PASSWORD:
            problems.append("OPS_ADMIN_PASSWORD is still the public development default")
        if not self.cors_origin_list:
            problems.append("CORS_ORIGINS is empty")
        if any(origin == "*" for origin in self.cors_origin_list):
            problems.append("CORS_ORIGINS contains a '*' wildcard, which is unsafe for an authenticated API")

        if problems:
            raise InsecureProductionConfig(
                "Refusing to start in production with insecure configuration: "
                + "; ".join(problems)
                + ". Set these via the environment before deploying."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
