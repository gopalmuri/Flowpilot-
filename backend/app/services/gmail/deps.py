"""FastAPI dependencies for the Gmail integration. Tests override these so nothing ever reaches Google."""

from app.services.gmail import pubsub as pubsub_service
from app.services.gmail.client import default_client_factory
from app.services.gmail.oauth import default_oauth_client
from app.services.gmail.types import GmailClientFactory, OAuthClient


def get_oauth_client() -> OAuthClient:
    return default_oauth_client()


def get_client_factory() -> GmailClientFactory:
    return default_client_factory


def get_pubsub_verifier() -> pubsub_service.PubSubVerifier:
    return pubsub_service.default_pubsub_verifier()
