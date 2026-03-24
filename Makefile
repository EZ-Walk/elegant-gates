.PHONY: up down record pull-model logs clean

up:
	docker compose up -d

down:
	docker compose down

record:
	cd services/recorder && python recorder.py

pull-model:
	docker compose exec ollama ollama pull phi3

logs:
	docker compose logs -f

clean:
	rm -f shared/recordings/*.wav
