#!/usr/bin/env python3
"""
Send notifications about Chutes Search status updates.

Credentials MUST be provided via environment variables (never commit tokens):
- TG_BOT_TOKEN
- TG_CHAT_ID
- PUSHBULLET_API_KEY (optional)
"""

import os
import sys
from typing import Optional

import requests

def _get_env(name: str) -> Optional[str]:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else None


def send_telegram_notification(message: str) -> bool:
    """Send Telegram notification."""
    try:
        bot_token = _get_env("TG_BOT_TOKEN")
        chat_id = _get_env("TG_CHAT_ID")

        if not bot_token or not chat_id:
            print("⚠️ Telegram env not set (TG_BOT_TOKEN/TG_CHAT_ID); skipping.")
            return False
        
        response = requests.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            data={"chat_id": chat_id, "text": message},
            timeout=20
        )
        
        if response.status_code == 200:
            print("✅ Telegram notification sent successfully!")
            return True
        else:
            print(f"❌ Telegram notification failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Telegram notification error: {e}")
        return False

def send_pushbullet_notification(message: str) -> bool:
    """Send Pushbullet notification (optional)."""
    try:
        api_key = _get_env("PUSHBULLET_API_KEY")
        if not api_key:
            print("ℹ️ PUSHBULLET_API_KEY not set; skipping Pushbullet.")
            return False

        response = requests.post(
            "https://api.pushbullet.com/v2/pushes",
            headers={"Access-Token": api_key, "Content-Type": "application/json"},
            json={"type": "note", "title": "Chutes Search Update", "body": message},
            timeout=20,
        )

        if response.status_code == 200:
            print("✅ Pushbullet notification sent successfully!")
            return True

        print(f"❌ Pushbullet notification failed: {response.status_code} - {response.text}")
        return False
    except Exception as e:
        print(f"❌ Pushbullet notification error: {e}")
        return False

def main():
    """Main function to send all notifications"""
    message = sys.argv[1] if len(sys.argv) > 1 else "Chutes Search update"
    print("📤 Sending notifications...")
    
    # Send Telegram notification
    telegram_success = send_telegram_notification(message)
    
    # Send Pushbullet notification
    pushbullet_success = send_pushbullet_notification(message)
    
    if telegram_success and pushbullet_success:
        print("\n🎉 All notifications sent successfully!")
        return 0
    elif telegram_success or pushbullet_success:
        print("\n⚠️ Some notifications failed, but at least one was sent successfully!")
        return 0
    else:
        print("\n❌ All notifications failed!")
        return 1

if __name__ == "__main__":
    sys.exit(main())
