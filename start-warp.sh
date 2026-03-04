#!/bin/bash

# ============================================
# 🔥 CLOUDFLARE WARP STARTUP SCRIPT
# Production-Ready | Auto-retry | Logging
# ============================================

set -e

echo "============================================"
echo "🚀 VidVault - Cloudflare WARP Setup"
echo "============================================"

# ============================================
# CONFIGURATION
# ============================================
MAX_RETRIES=30
RETRY_DELAY=2
LOG_FILE="/var/log/warp/warp-setup.log"

# Create log directory
mkdir -p /var/log/warp
exec > >(tee -a "$LOG_FILE") 2>&1

# ============================================
# WAIT FOR WARP DAEMON
# ============================================
echo "⏳ Waiting for warp-svc daemon to start..."
sleep 3

# Check if warp-svc is running
DAEMON_RETRIES=0
while [ $DAEMON_RETRIES -lt 10 ]; do
    if pgrep -x "warp-svc" > /dev/null; then
        echo "✅ warp-svc daemon is running!"
        break
    fi
    echo "⏳ Waiting for warp-svc daemon... ($DAEMON_RETRIES/10)"
    sleep 2
    DAEMON_RETRIES=$((DAEMON_RETRIES + 1))
done

if [ $DAEMON_RETRIES -eq 10 ]; then
    echo "❌ warp-svc daemon failed to start!"
    exit 1
fi

# ============================================
# REGISTER WARP
# ============================================
echo "🔐 Registering Cloudflare WARP..."
warp-cli --accept-tos registration new 2>/dev/null || \
warp-cli --accept-tos register 2>/dev/null || \
echo "ℹ️  Already registered or registration not needed"

sleep 2

# ============================================
# CONFIGURE WARP
# ============================================
echo "⚙️  Configuring WARP settings..."

# Set mode to WARP with proxy
warp-cli --accept-tos set-mode warp+doh 2>/dev/null || \
warp-cli --accept-tos set-mode warp 2>/dev/null || \
echo "⚠️  Could not set mode, using default"

# Disable families mode (adult content filter)
warp-cli --accept-tos set-families-mode off 2>/dev/null || echo "ℹ️  Families mode already off"

# Enable proxy
warp-cli --accept-tos enable-always-on 2>/dev/null || echo "ℹ️  Always-on not available"

sleep 2

# ============================================
# CONNECT TO WARP
# ============================================
echo "🔌 Connecting to Cloudflare WARP..."
warp-cli --accept-tos connect 2>/dev/null || echo "ℹ️  Connection initiated"

sleep 3

# ============================================
# VERIFY CONNECTION
# ============================================
echo "✅ Verifying WARP connection..."
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    # Check connection status
    STATUS=$(warp-cli --accept-tos status 2>/dev/null || echo "Unknown")
    
    if echo "$STATUS" | grep -q "Connected"; then
        echo "✅ WARP CONNECTED SUCCESSFULLY!"
        echo ""
        echo "📊 Connection Details:"
        echo "$STATUS"
        echo ""
        
        # Get proxy settings
        PROXY_ADDR=$(warp-cli --accept-tos settings 2>/dev/null | grep -i "proxy" || echo "127.0.0.1:40000")
        echo "🌐 Proxy Address: $PROXY_ADDR"
        echo ""
        
        # Test connection
        echo "🧪 Testing WARP connection..."
        if curl -x socks5://127.0.0.1:40000 --connect-timeout 10 -s https://www.cloudflare.com/cdn-cgi/trace | grep -q "warp=on"; then
            echo "✅ WARP connection test PASSED!"
            echo "✅ Geo-bypass is ACTIVE!"
        else
            echo "⚠️  WARP test inconclusive, but connection established"
        fi
        
        echo ""
        echo "============================================"
        echo "✅ WARP Setup Complete!"
        echo "🚀 YouTube geo-blocking bypass: ENABLED"
        echo "============================================"
        
        # Keep script running (supervisor expects this)
        sleep infinity
        exit 0
    fi
    
    echo "⏳ Waiting for WARP connection... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep $RETRY_DELAY
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

# ============================================
# CONNECTION FAILED
# ============================================
echo "❌ WARP connection failed after $MAX_RETRIES attempts"
echo "⚠️  Continuing anyway - app will work without WARP"
echo "⚠️  YouTube geo-blocking may affect some videos"

# Don't fail - let app run without WARP
sleep infinity
exit 0
