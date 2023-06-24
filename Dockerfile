FROM node:18.9-alpine

WORKDIR /usr/app

COPY package.json yarn.lock ./
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh
RUN yarn --prod
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

ENTRYPOINT ["/docker-entrypoint.sh"]
