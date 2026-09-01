.PHONY: install dev build lint test check clean

install:
	npm ci
	go -C beacon-server mod download

dev:
	npm run dev

build:
	npm run build

lint:
	npm run lint

test:
	npm test

check:
	npm run check

clean:
	rm -rf beacon-web/dist beacon-web/coverage
	go -C beacon-server clean
