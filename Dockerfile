FROM node:18.9-alpine

RUN apk add git

WORKDIR /usr/app

COPY . .

RUN chown -R node:node /usr/app
USER node
RUN chmod +x ./docker-entrypoint.sh

ENV APP_ENV=docker
RUN yarn --prod
# If you are building your code for production
# RUN npm ci --only=production

RUN yarn write-version-data

ENTRYPOINT ["./docker-entrypoint.sh"]
