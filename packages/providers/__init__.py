"""Model adapters. The H1 adapter sends text only when explicitly requested."""

from .meta import MetaProviderError, provider_status, propose_guidance

__all__ = ["MetaProviderError", "provider_status", "propose_guidance"]
