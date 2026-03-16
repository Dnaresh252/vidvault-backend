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
# Force rebuild - v20260316-006
FROM node:20-bullseye-slim

# Cache buster
ARG CACHEBUST=20260316-006
RUN echo "Build timestamp: $CACHEBUST"

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    gcc \
    python3-dev \
    libssl-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install yt-dlp and immediately update to latest
RUN echo "Installing yt-dlp at $(date)" && \
    pip install --no-cache-dir -U pip && \
    pip install --no-cache-dir yt-dlp && \
    echo "Initial version:" && \
    yt-dlp --version && \
    echo "Updating to latest..." && \
    yt-dlp -U && \
    echo "Final version:" && \
    yt-dlp --version

RUN pip install --no-cache-dir curl-cffi
RUN pip install --no-cache-dir gallery-dl
RUN gallery-dl --version

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

RUN echo "Copying code at $(date)"
COPY . .

RUN mkdir -p /tmp/downloads /tmp/temp /tmp/ig-images && \
    chmod 777 /tmp/downloads /tmp/temp /tmp/ig-images

USER node

EXPOSE 5000

CMD ["node", "server.js"]