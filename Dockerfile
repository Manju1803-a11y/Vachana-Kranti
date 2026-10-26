FROM node:20-alpine

WORKDIR /app

# Copy package definitions
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application source
COPY . .

# Expose port (Render sets $PORT dynamically)
EXPOSE 10000

CMD ["node", "server.js"]
