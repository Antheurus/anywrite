default:
    @just --list

install:
    bun install

build: install
    bun run build

test: install
    bun run test

check: install
    bun run check

codegen: install
    bun run codegen

clean:
    rm -rf dist node_modules
