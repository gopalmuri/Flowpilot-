FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better caching
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

EXPOSE 5173

# Start development server binding to all interfaces
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
