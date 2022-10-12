FROM node:18.9-alpine

WORKDIR /usr/app

COPY package.json yarn.lock ./

RUN yarn --prod
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

CMD [ "node", "dist/App.js" ]
