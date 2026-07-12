from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str
    position: int
    provider: str


class SearchProvider(ABC):
    name: str

    @abstractmethod
    async def search(self, query: str, max_results: int = 8) -> list[SearchHit]:
        raise NotImplementedError
