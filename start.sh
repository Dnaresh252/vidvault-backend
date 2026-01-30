#!/bin/sh
set -e

echo "🔄 Updating yt-dlp to latest..."
yt-dlp -U || echo "⚠ yt-dlp update failed, continuing..."

echo "📦 yt-dlp version:"
yt-dlp --version

echo "🚀 Starting server..."
node server.js
