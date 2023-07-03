build:
	tsc

run:
	./run.sh

run-second:
	./run.sh second

docker:
	docker buildx build --platform linux/amd64 --push -t  polipaul/agent-v2-bot:dev .

docker-release:
	docker buildx build --platform linux/amd64 --push -t  polipaul/agent-v2-bot:latest .

up:
	docker compose up -d

down:
	docker compose down

pull:
	docker compose pull
