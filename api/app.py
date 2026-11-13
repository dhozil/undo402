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

CONTRACT_ADDRESS = os.environ.get("UNDO402_CONTRACT_ADDRESS", "0xaee085b0f4921953dD3474a15467D73E3E90F2AD")
ESCROW_ADDRESS = os.environ.get("ESCROW", os.environ.get("ESCROW_CONTRACT", "0x85bC06C938532EF89388A401637bE1B8F7ac9037"))
STUDIONET_RPC = "https://studio.genlayer.com/api"
CHAIN_ID = 61999
Rail = Literal["x402", "chain", "card"]


class CreatePayment(BaseModel):
    actor_address: str
    payment_id: str = ""  # must match the Base escrow id when provided
    seller: str
    rail: Rail
    criteria: str
    payment_proof: str
    amount_usdc: int = Field(default=1000000, gt=0)
    ttl_seconds: int = 86400
    evidence_urls: str = ""


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
        out = _parse_json_output(proc.stdout)
    except Exception:
        raise HTTPException(502, f"Relay failed: {proc.stdout[-500:]} {proc.stderr[-500:]}")
    if not out.get("ok"):
        detail = f"Contract execution failed: {out.get('error')}"
        if out.get("txHash"):
            detail += f" | tx: {out['txHash']}"
        if out.get("explorer"):
            detail += f" | explorer: {out['explorer']}"
        raise HTTPException(502, detail)
    return {"ok": True, "tx": out.get("hash"), "finalized": out.get("finalized", False), "status": out.get("status"), "function": fn, "args": args, "network": "studionet"}


@app.get("/health")
def health():
    return {"ok": True, "network": "studionet", "chain_id": CHAIN_ID, "contract": CONTRACT_ADDRESS}


@app.post("/payments", status_code=201)
def create_payment(body: CreatePayment):
    _validate_proof(body.rail, body.payment_proof)
    if body.payment_id:
        return _call("create_payment_with_id", [body.actor_address, body.payment_id, body.seller, body.rail, body.criteria, body.payment_proof, body.amount_usdc, body.ttl_seconds, body.evidence_urls])
    return _call("create_payment", [body.actor_address, body.seller, body.rail, body.criteria, body.payment_proof, body.amount_usdc, body.ttl_seconds, body.evidence_urls])


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


def _parse_json_output(stdout: str):
    """Parse JSON emitted by the Node bridges.

    `api_call.mjs` prints exactly one line, while `settle.mjs --json` pretty
    prints a multi-line document. Try the whole payload first, then the last
    non-empty line for mixed/streamed output.
    """
    text = (stdout or "").strip()
    if not text:
        raise ValueError("empty stdout")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise ValueError("no JSON object found in stdout")


@app.post("/payments/{payment_id}/settle")
def settle(payment_id: str, check: bool = False):
    """Idempotent GenLayer -> Base settlement (scripts/settle.mjs).

    Verifies payment id, verdict, attestation binding and partial split, then
    invokes the matching escrow exactly once. Safe to retry: if the escrow is
    already terminal with the same attestation it returns without a tx.
    """
    env = {
        **os.environ,
        "UNDO402_CONTRACT_ADDRESS": CONTRACT_ADDRESS,
        "ESCROW": ESCROW_ADDRESS,
        "GENLAYER_RPC_URL": STUDIONET_RPC,
    }
    cmd = ["node", str(BASE / "scripts" / "settle.mjs"), "--payment", payment_id, "--json"]
    if check:
        cmd.append("--check")
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env, cwd=str(BASE))
    try:
        out = _parse_json_output(proc.stdout)
    except Exception:
        raise HTTPException(502, f"Settlement failed: {proc.stdout[-500:]} {proc.stderr[-500:]}")
    if not out.get("ok"):
        raise HTTPException(409, out)
    return out


@app.get("/payments/{payment_id}")
def get_payment(payment_id: str):
    env = {**os.environ, "UNDO402_CONTRACT_ADDRESS": CONTRACT_ADDRESS, "GENLAYER_RPC_URL": STUDIONET_RPC}
    proc = subprocess.run(["node", str(BASE / "scripts" / "api_call.mjs"), "get_payment", json.dumps([payment_id])], capture_output=True, text=True, timeout=120, env=env, cwd=str(BASE))
    try:
        out = _parse_json_output(proc.stdout)
        return out
    except Exception:
        raise HTTPException(502, f"Read failed: {proc.stdout[-300:]} {proc.stderr[-300:]}")


@app.get("/payments")
def list_payments():
    env = {**os.environ, "UNDO402_CONTRACT_ADDRESS": CONTRACT_ADDRESS, "GENLAYER_RPC_URL": STUDIONET_RPC}
    proc = subprocess.run(["node", str(BASE / "scripts" / "api_call.mjs"), "get_payments", "[]"], capture_output=True, text=True, timeout=120, env=env, cwd=str(BASE))
    try:
        return _parse_json_output(proc.stdout)
    except Exception:
        raise HTTPException(502, f"Read failed: {proc.stdout[-300:]} {proc.stderr[-300:]}")
