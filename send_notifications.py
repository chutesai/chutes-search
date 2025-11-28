#!/usr/bin/env python3
"""
Send notifications about Chutes Search deployment completion
"""

import sys
import os
import requests

# Add path for notifications module
sys.path.append('/home/flori/Dev/chutes/algotrading/backend/app')

def send_telegram_notification():
    """Send Telegram notification about deployment completion"""
    try:
        bot_token = "8264160091:AAHJVlv2MYbaU4plbpmBLnKn6Wi-vG52nGM"
        chat_id = "7367548582"
        
        message = """🚀 Chutes Search Deployment Complete!

✅ All requested improvements implemented:
• Speed model updated to Alibaba-NLP/Tongyi-DeepResearch-30B-A3B
• Mobile scrollbar fixed in Discover page
• Article loading reliability improved
• Broken images now hidden completely (no more ugly icons!)
• Weather tile clickable for location searches
• User isolation via local storage (no more shared chats)
• Focus/Attach icons hidden as requested
• File attachment hidden in follow-up mode

🌐 Live at: https://chutes-search.onrender.com/
📋 Changes deployed to chutes-integration branch

All features ready for testing! 🎉"""
        
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

def send_pushbullet_notification():
    """Send Pushbullet notification about deployment completion"""
    try:
        # Import the existing pushbullet module
        from notifications import pushbullet
        
        message = """🚀 Chutes Search Deployment Complete!

All requested improvements have been successfully implemented and deployed:

✅ Speed model updated to Alibaba-NLP/Tongyi-DeepResearch-30B-A3B
✅ Mobile scrollbar fixed in Discover page headers
✅ Article loading reliability improved with better error handling
✅ Broken images now completely hidden (no more ugly broken icons!)
✅ Weather tile made clickable for location-based searches
✅ User isolation implemented via browser local storage
✅ Focus and Attach icons hidden from main interface
✅ File attachment symbol hidden in follow-up mode

The deployment is live at https://chutes-search.onrender.com/
Changes are in the chutes-integration branch and should be visible within 2-5 minutes.

Ready for testing! 🎉"""
        
        pushbullet.send_notification(
            title="Chutes Search Deployment Complete",
            body=message
        )
        
        print("✅ Pushbullet notification sent successfully!")
        return True
        
    except Exception as e:
        print(f"❌ Pushbullet notification error: {e}")
        # Fallback to direct API call
        try:
            api_key = "o.VUVCoj5JJDZq9IeiOxiNrLnbSrGi0xud"
            response = requests.post(
                "https://api.pushbullet.com/v2/pushes",
                headers={"Access-Token": api_key, "Content-Type": "application/json"},
                json={"type": "note", "title": "Chutes Search Deployment Complete", "body": message},
                timeout=20
            )
            
            if response.status_code == 200:
                print("✅ Pushbullet notification sent via fallback!")
                return True
            else:
                print(f"❌ Pushbullet fallback failed: {response.status_code}")
                return False
                
        except Exception as fallback_error:
            print(f"❌ Pushbullet fallback also failed: {fallback_error}")
            return False

def main():
    """Main function to send all notifications"""
    print("📤 Sending deployment notifications...")
    
    # Send Telegram notification
    telegram_success = send_telegram_notification()
    
    # Send Pushbullet notification
    pushbullet_success = send_pushbullet_notification()
    
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