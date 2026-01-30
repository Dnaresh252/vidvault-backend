
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# -------------------------------
# Python venv + yt-dlp
# -------------------------------
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip yt-dlp

# -------------------------------
# App setup
# -------------------------------
WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# -------------------------------
# FIX PERMISSIONS (CRITICAL)
# -------------------------------
RUN chmod +x /app/start.sh && \
    mkdir -p /tmp/downloads /tmp/temp && \
    chmod 777 /tmp/downloads /tmp/temp

# -------------------------------
# Run as node user
# -------------------------------
USER node

EXPOSE 5000

# -------------------------------
# START USING SHELL (NOT NODE)
# -------------------------------
CMD ["sh", "-c", "./start.sh"]
