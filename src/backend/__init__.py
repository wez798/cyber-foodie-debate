"""
Cyber Foodie Debate - Backend Application
AI校园干饭辩论赛与美食擂台 - 后端服务
"""

from .app import create_app as create_app
from .config import Settings as Settings

__version__ = "0.1.0"

__all__ = ["Settings", "create_app"]
