# FROM node:20-slim

# RUN apt-get update && apt-get install -y \
#     python3 \
#     python3-pip \
#     python3-venv \
#     ffmpeg \
#     curl \
#     ca-certificates \
#     gcc \
#     python3-dev \
#     libssl-dev \
#     && rm -rf /var/lib/apt/lists/*

# RUN python3 -m venv /opt/venv
# ENV PATH="/opt/venv/bin:$PATH"

# RUN pip install --no-cache-dir -U --pre "yt-dlp[default]"
# RUN pip install --no-cache-dir curl-cffi
# RUN pip install --no-cache-dir gallery-dl
# RUN yt-dlp --version
# RUN gallery-dl --version

# WORKDIR /app

# COPY package*.json ./
# RUN npm ci --only=production

# COPY . .

# RUN mkdir -p /tmp/downloads /tmp/temp /tmp/ig-images && \
#     chmod 777 /tmp/downloads /tmp/temp /tmp/ig-images

# USER node

# EXPOSE 5000

# CMD ["node", "server.js"]
# ============================================
# 🔥 VIDVAULT PRODUCTION DOCKERFILE
# Rank #1 Quality - Cloudflare WARP Enabled
# ============================================

FROM node:20-bullseye

# ============================================
# INSTALL SYSTEM DEPENDENCIES
# ============================================
RUN apt-get update && apt-get install -y \
    # Python & build tools
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    gcc \
    libssl-dev \
    # Media processing
    ffmpeg \
    # Network tools
    curl \
    wget \
    ca-certificates \
    gnupg \
    lsb-release \
    # Process management
    supervisor \
    && rm -rf /var/lib/apt/lists/*

# ============================================
# INSTALL CLOUDFLARE WARP (GEO-BYPASS)
# ============================================
RUN curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | \
    gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ bullseye main" | \
    tee /etc/apt/sources.list.d/cloudflare-client.list && \
    apt-get update && \
    apt-get install -y cloudflare-warp && \
    rm -rf /var/lib/apt/lists/*

# ============================================
# SETUP PYTHON VIRTUAL ENVIRONMENT
# ============================================
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ============================================
# INSTALL YT-DLP & DOWNLOADERS (LATEST)
# ============================================
RUN pip install --no-cache-dir -U --pre "yt-dlp[default]" && \
    pip install --no-cache-dir curl-cffi && \
    pip install --no-cache-dir gallery-dl && \
    yt-dlp --version && \
    gallery-dl --version

# ============================================
# VERIFY INSTALLATIONS
# ============================================
RUN echo "✅ Node: $(node --version)" && \
    echo "✅ Python: $(python3 --version)" && \
    echo "✅ yt-dlp: $(yt-dlp --version)" && \
    echo "✅ ffmpeg: $(ffmpeg -version | head -n1)" && \
    echo "✅ WARP: $(warp-cli --version 2>/dev/null || echo 'installed')"

# ============================================
# APPLICATION SETUP
# ============================================
WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy application code
COPY . .

# ============================================
# CREATE REQUIRED DIRECTORIES
# ============================================
RUN mkdir -p /tmp/downloads /tmp/temp /tmp/ig-images /tmp/cookies /var/log/warp && \
    chmod -R 777 /tmp/downloads /tmp/temp /tmp/ig-images /tmp/cookies /var/log/warp

# ============================================
# SETUP SUPERVISOR (WARP + NODE.JS)
# ============================================
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY start-warp.sh /app/start-warp.sh
RUN chmod +x /app/start-warp.sh

# ============================================
# HEALTH CHECK
# ============================================
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:5000/api/v1/health || exit 1

# ============================================
# EXPOSE PORT
# ============================================
EXPOSE 5000

# ============================================
# ENVIRONMENT VARIABLES
# ============================================
ENV NODE_ENV=production \
    WARP_PROXY_URL=socks5://127.0.0.1:40000 \
    WARP_ENABLED=true

# ============================================
# START APPLICATION (SUPERVISOR MANAGES WARP + NODE)
# ============================================
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
