# Supported Languages & Frameworks

## General-purpose

| Language | Extensions |
|----------|-----------|
| TypeScript | `.ts` |
| JavaScript | `.js` |
| TSX | `.tsx` |
| JSX | `.jsx` |
| Python | `.py` |
| Go | `.go` |
| Rust | `.rs` |
| Java | `.java` |
| C | `.c`, `.h` |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp` |
| C# | `.cs` |
| PHP | `.php` |
| Ruby | `.rb` |
| Swift | `.swift` |
| Kotlin | `.kt` |
| Dart | `.dart` |
| Scala | `.scala`, `.sc`, `.sbt` |
| Lua | `.lua` |
| Zig | `.zig`, `.zon` |
| Bash | `.sh`, `.bash`, `.zsh` |
| OCaml | `.ml`, `.mli` |
| Elm | `.elm` |
| Objective-C | `.m` |

## Frontend & UI

| Language | Extensions |
|----------|-----------|
| React / React Native | `.tsx`, `.jsx` (via TypeScript/JSX grammars) |
| Next.js | `.tsx`, `.jsx` (via TypeScript/JSX grammars) |
| Angular | `.ts`, `.html` (via TypeScript/HTML grammars) |
| Svelte | `.svelte` |
| Vue | `.vue` |
| HTML | `.html`, `.htm` |
| CSS | `.css` |
| SCSS / Sass | `.scss`, `.sass` |

## Domain-specific

| Language | Domain | Extensions |
|----------|--------|-----------|
| Solidity | Blockchain / Web3 | `.sol` |
| Elixir | Distributed systems / Real-time | `.ex`, `.exs` |

## Configuration & Infrastructure

| Language | Extensions |
|----------|-----------|
| YAML | `.yaml`, `.yml` |
| HCL (Terraform) | `.tf`, `.tfvars` |

---

## Framework Detection

KiroGraph automatically detects frameworks and enriches the graph with framework-specific semantics (routes, components, lifecycle methods):

### Web Frameworks

**JavaScript / TypeScript:** React, Next.js, React Native, Angular, Svelte, SvelteKit, Express, Fastify, Koa

**Vue:** Vue, Nuxt

**Python:** Django, Flask, FastAPI

**Ruby:** Rails

**Java:** Spring, Spring Boot, Spring MVC

**Scala:** Play, Akka HTTP, http4s

**Go:** generic Go resolver

**Rust:** generic Rust resolver

**C#:** ASP.NET Core

**Swift:** SwiftUI, UIKit, Vapor

**PHP:** Laravel

**Elixir:** Phoenix

**Solidity:** Hardhat, Foundry, Truffle (OpenZeppelin patterns)

### Infrastructure as Code

AWS CDK, SST, Serverless Framework, AWS SAM, Terraform / OpenTofu, Pulumi, CloudFormation, AWS Amplify Gen 2

### Containers & Orchestration

Kubernetes, Helm, Docker Compose

### Configuration Management

Ansible

Detected frameworks are stored in config and used to improve symbol extraction and resolution.
