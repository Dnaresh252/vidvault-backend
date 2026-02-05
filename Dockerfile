# -------------------------------
# ✅ Base image
# -------------------------------
FROM node:20-slim

# -------------------------------
# 🧩 Install dependencies
# -------------------------------
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# -------------------------------
# 🧠 Set up Python virtual env + yt-dlp
# -------------------------------
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip "yt-dlp[default]"
RUN yt-dlp --version

# -------------------------------
# 📦 Setup working directory
# -------------------------------
WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app source
COPY . .

# -------------------------------
# 🗂 Create temp directories
# -------------------------------
RUN mkdir -p /tmp/downloads /tmp/temp && \
    chmod 777 /tmp/downloads /tmp/temp

# -------------------------------
# 👤 Use built-in 'node' user instead of creating new one
# -------------------------------
USER node

# -------------------------------
# 🚀 Expose and start
# -------------------------------
EXPOSE 5000
CMD ["sh", "-c", "yt-dlp -U || true && node server.js"]

