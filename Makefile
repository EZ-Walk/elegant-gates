.PHONY: up down record pull-model logs clean test

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

# End-to-end test - pass AUDIO=path/to/file.m4a
# Usage: make test AUDIO=tests/test_001.m4a
test:
	@test -n "$(AUDIO)" || (echo "Usage: make test AUDIO=path/to/file.m4a" && exit 1)
	@test -d .venv || python3 -m venv .venv
	.venv/bin/pip install -q -r tests/requirements.txt
	.venv/bin/pytest tests/test_vessel_tracking.py -v --audio $(AUDIO)
