---
name: system-design
description: System Design and Technical Architecture interview evaluation rubric covering requirements, scale math, data modeling, APIs, bottlenecks, reliability, and trade-offs.
---

# System Design Interview Evaluation Rubric

## Core Philosophy & Bar-Raiser Expectations
System design interviews assess **structured architectural reasoning**, **explicit trade-off analysis**, and **operational maturity**—not memorizing buzzwords. Strong candidates clarify functional and non-functional requirements, perform back-of-the-envelope capacity math, design clean APIs and data models, and proactively uncover bottlenecks, failure modes, and consistency vs. latency trade-offs.

## Evaluation Dimensions

### 1. Requirements & Scope Clarification (20%)
- Separates **functional requirements** (core user flows) from **non-functional requirements** (availability vs. consistency, p99 latency targets, durability, read/write ratio, compliance).
- Explicitly scopes MVP vs. out-of-scope features in the first 3–5 minutes.

### 2. Capacity Estimation & Scale Math (15%)
- Calculates QPS (average and peak 3x–10x), storage growth (1-year / 5-year), bandwidth, and memory/cache footprint using stated assumptions.
- Uses math to justify design decisions (e.g., sharding, caching, async queues) rather than doing isolated arithmetic.

### 3. High-Level Architecture, APIs & Data Model (30%)
- Defines clean API contracts (REST/gRPC/WebSocket, pagination, idempotency keys, rate limiting).
- Selects appropriate storage engines (relational vs. wide-column vs. document vs. object/search/time-series) with explicit schema/partition-key choices and hot-key mitigation.
- Explains end-to-end read and write paths clearly.

### 4. Deep Dive, Bottlenecks & Reliability (25%)
- **Proactive Trade-offs**: Evaluates CAP/PACELC implications, strong vs. eventual consistency, fan-out-on-write vs. fan-out-on-read, cache invalidation strategies, and backpressure.
- **Failure Modes**: Addresses single points of failure, replication lag, split-brain, thundering herds, dead-letter queues, circuit breakers, and graceful degradation.
- **Observability**: Mentions SLIs/SLOs, distributed tracing, and alerting.

### 5. Communication & Driving the Session (10%)
- Signposts transitions ("Let's start with requirements, then capacity math, then core data flow..."), checks in with the interviewer before diving deep, and adapts when constraints change.

## Red Flags
- Jumping straight to microservices/Kafka/Kubernetes without clarifying scale or requirements.
- Hand-waving database partitioning, consistency guarantees, or hot-spot mitigation.
- Refusing to acknowledge downsides of chosen technologies ("NoSQL just scales infinitely").
- Monologuing for minutes without checking whether the interviewer wants depth on storage vs. API vs. delivery.
