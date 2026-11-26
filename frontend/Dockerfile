# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- serve stage ----
FROM nginx:alpine AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
# If VITE_API_URL points at a backend reachable from the browser, nginx just
# serves static files. Optionally proxy same-origin /api to a backend container:
# docker build --build-arg VITE_API_URL=https://api.example.com/api .
CMD ["nginx", "-g", "daemon off;"]
