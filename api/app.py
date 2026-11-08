"""Undo402 Dispute API — live relay for StudioNet + Base Sepolia.

Wraps Undo402 (GenLayer StudioNet adjudication) + Undo402Escrow (Base
USDC). Writes are submitted via the Node relay (api/relay.mjs) using the
seller wallet key from WALLET_DIR/seller.json or GENLAYER_PRIVATE_KEY env.
Reads go directly to StudioNet via genlayer-js through the same bridge.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent.parent
app = FastAPI(title="Undo402 Dispute API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

CONTRACT_ADDRESS = os.environ.get("UNDO402_CONTRACT_ADDRESS", "0x6C7ea251273aC4FDF8d3C9B36F2E3089bb4c3660")
STUDIONET_RPC = "https://studio.genlayer.com/api"
CHAIN_ID = 61999
Rail = Literal["x402", "chain", "card"]


class CreatePayment(BaseModel):
    actor_address: str
    seller: str
    rail: Rail
    criteria: str
    payment_proof: str
    amount_usdc: int = Field(default=1000000, gt=0)
    ttl_seconds: int = 86400


class Delivery(BaseModel):
    actor_address: str
    delivery_url: str
    note: str = ""


class ActorAction(BaseModel):
    actor_address: str


class Dispute(BaseModel):
    actor_address: str
    reason: str


class CounterEvidence(BaseModel):
    actor_address: str
    evidence_url: str


class Propose(BaseModel):
    actor_address: str
    outcome: str


class HumanResolve(BaseModel):
    decision: str


def _validate_proof(rail: str, proof: str) -> None:
    if rail in ("x402", "chain") and not re.fullmatch(r"0x[0-9a-fA-F]{64}", proof.strip()):
        raise HTTPException(400, "Invalid payment proof: expected 0x tx hash")
    if rail == "card" and not proof.strip().startswith(("pi_", "card:")):
        raise HTTPException(400, "Invalid payment proof: expected pi_ or card: reference")


def _call(fn: str, args: list):
    env = {**os.environ, "UNDO402_CONTRACT_ADDRESS": CONTRACT_ADDRESS, "GENLAYER_RPC_URL": STUDIONET_RPC}
    proc = subprocess.run(
        ["node", str(BASE / "scripts" / "api_call.mjs"), fn, json.dumps(args)],
        capture_output=True, text=True, timeout=300, env=env, cwd=str(BASE),
    )
    try:
        out = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception:
        raise HTTPException(502, f"Relay failed: {proc.stdout[-500:]} {proc.stderr[-500:]}")
    if not out.get("ok"):
        raise HTTPException(502, f"Contract execution failed: {out.get('error')}")
    return {"ok": True, "tx": out.get("hash"), "function": fn, "args": args, "network": "studionet"}


@app.get("/health")
def health():
    return {"ok": True, "network": "studionet", "chain_id": CHAIN_ID, "contract": CONTRACT_ADDRESS}


@app.post("/payments", status_code=201)
def create_payment(body: CreatePayment):
    _validate_proof(body.rail, body.payment_proof)
    return _call("create_payment", [body.actor_address, body.seller, body.rail, body.criteria, body.payment_proof, body.amount_usdc, body.ttl_seconds])


@app.post("/payments/{payment_id}/delivery")
def submit_delivery(payment_id: str, body: Delivery):
    return _call("submit_delivery", [body.actor_address, payment_id, body.delivery_url, body.note])


@app.post("/payments/{payment_id}/accept")
def accept(payment_id: str, body: ActorAction):
    return _call("accept", [body.actor_address, payment_id])


@app.post("/payments/{payment_id}/timeout")
def claim_timeout(payment_id: str, body: ActorAction):
    return _call("claim_timeout", [body.actor_address, payment_id])


@app.post("/payments/{payment_id}/dispute")
def open_dispute(payment_id: str, body: Dispute):
    return _call("open_dispute", [body.actor_address, payment_id, body.reason])


@app.post("/payments/{payment_id}/counter-evidence")
def counter_evidence(payment_id: str, body: CounterEvidence):
    return _call("submit_counter_evidence", [body.actor_address, payment_id, body.evidence_url])


@app.post("/payments/{payment_id}/propose")
def propose(payment_id: str, body: Propose):
    return _call("propose_outcome", [body.actor_address, payment_id, body.outcome])


@app.post("/payments/{payment_id}/human-resolve")
def human_resolve(payment_id: str, body: HumanResolve):
    return _call("human_resolve", [payment_id, body.decision])


@app.post("/payments/{payment_id}/resolve")
def resolve(payment_id: str):
    return _call("resolve_dispute", [payment_id])


@app.get("/payments/{payment_id}")
def get_payment(payment_id: str):
    env = {**os.environ, "UNDO402_CONTRACT_ADDRESS": CONTRACT_ADDRESS, "GENLAYER_RPC_URL": STUDIONET_RPC}
    proc = subprocess.run(["node", str(BASE / "scripts" / "api_call.mjs"), "get_payment", json.dumps([payment_id])], capture_output=True, text=True, timeout=120, env=env, cwd=str(BASE))
    try:
        out = json.loads(proc.stdout.strip().splitlines()[-1])
        return out
    except Exception:
        raise HTTPException(502, f"Read failed: {proc.stdout[-300:]} {proc.stderr[-300:]}")


@app.get("/payments")
def list_payments():
    env = {**os.environ, "UNDO402_CONTRACT_ADDRESS": CONTRACT_ADDRESS, "GENLAYER_RPC_URL": STUDIONET_RPC}
    proc = subprocess.run(["node", str(BASE / "scripts" / "api_call.mjs"), "get_payments", "[]"], capture_output=True, text=True, timeout=120, env=env, cwd=str(BASE))
    try:
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception:
        raise HTTPException(502, f"Read failed: {proc.stdout[-300:]} {proc.stderr[-300:]}")
