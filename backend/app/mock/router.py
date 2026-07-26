"""Mock business APIs.

These stand in for the real Flipkart/Airtel/Apollo systems. This is the ONLY
place in the backend where a business name may appear — the runtime reaches
them purely through URLs declared in manifests.
"""

from __future__ import annotations

import hashlib
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/mock", tags=["mock business APIs"])


def _stable(seed: str, modulo: int) -> int:
    """Deterministic pseudo-randomness so a demo repeats identically."""
    return int(hashlib.sha256(seed.encode()).hexdigest(), 16) % modulo


def _day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).strftime("%A, %d %B")


# --------------------------------------------------------------------------- #
# Flipkart
# --------------------------------------------------------------------------- #
ITEMS = ["Wireless Earbuds", "Cotton Kurta", "Steel Water Bottle", "Running Shoes", "Table Lamp"]
STATUSES = ["out for delivery", "in transit", "packed at the warehouse", "delivered"]


@router.get("/flipkart/orders/{order_id}")
async def flipkart_order(order_id: str) -> dict[str, Any]:
    bucket = _stable(order_id, 4)
    delivered = bucket == 3
    return {
        "order_id": order_id,
        "item": ITEMS[_stable(order_id, len(ITEMS))],
        "status": STATUSES[bucket],
        "eta": "today, before 9 PM" if bucket == 0 else _day(bucket),
        "days_since_delivery": _stable(order_id, 12) if delivered else 0,
        "amount": f"₹{900 + _stable(order_id, 40) * 50}",
    }


@router.post("/flipkart/orders/{order_id}/cancel")
async def flipkart_cancel(order_id: str) -> dict[str, Any]:
    order = await flipkart_order(order_id)
    return {
        **order,
        "cancelled": order["status"] != "delivered",
        "refund_ref": f"RFND{_stable(order_id, 900000) + 100000}",
        "refund_note": f"{order['amount']} will be refunded to your original payment method in 5-7 business days.",
    }


@router.post("/flipkart/orders/{order_id}/refund")
async def flipkart_refund(order_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    order = await flipkart_order(order_id)
    return {
        **order,
        "refund_ref": f"RFND{_stable(order_id + 'r', 900000) + 100000}",
        "eta_days": 5,
        "reason": (payload or {}).get("reason") or "not specified",
    }


# --------------------------------------------------------------------------- #
# Airtel
# --------------------------------------------------------------------------- #
@router.get("/airtel/accounts/{account_id}/bill")
async def airtel_bill(account_id: str) -> dict[str, Any]:
    amount = 499 + _stable(account_id, 12) * 100
    return {
        "account_id": account_id,
        "amount": f"₹{amount}",
        "outstanding_amount": amount if _stable(account_id, 5) == 0 else 0,
        "due_date": _day(7 + _stable(account_id, 8)),
        "plan": "Fiber Unlimited 200 Mbps",
    }


@router.post("/airtel/accounts/{account_id}/fiber/cancel")
async def airtel_cancel_fiber(account_id: str) -> dict[str, Any]:
    bill = await airtel_bill(account_id)
    return {
        **bill,
        "ticket_id": f"AIR{_stable(account_id, 900000) + 100000}",
        "pickup_date": _day(2),
        "pickup_note": "An engineer will collect the router, and the final bill is settled after pickup.",
    }


@router.post("/airtel/accounts/{account_id}/tickets")
async def airtel_ticket(account_id: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "account_id": account_id,
        "ticket_id": f"AIR{_stable(account_id + 't', 900000) + 100000}",
        "issue": (payload or {}).get("issue") or "service issue",
        "sla_hours": 24,
        "status": "open",
    }


# --------------------------------------------------------------------------- #
# Apollo
# --------------------------------------------------------------------------- #
DOCTORS = {
    "general physician": ("Dr. Meera Rao", "Apollo Clinic, Indiranagar"),
    "dermatologist": ("Dr. Anil Kumar", "Apollo Clinic, Jayanagar"),
    "paediatrician": ("Dr. Sneha Reddy", "Apollo Cradle, Koramangala"),
    "cardiologist": ("Dr. Vikram Nair", "Apollo Hospital, Bannerghatta"),
}


def _doctor(speciality: str) -> tuple[str, str, str]:
    key = (speciality or "").strip().lower()
    for name, (doctor, clinic) in DOCTORS.items():
        if name in key or key in name:
            return doctor, clinic, name
    doctor, clinic = DOCTORS["general physician"]
    return doctor, clinic, "general physician"


@router.get("/apollo/doctors")
async def apollo_doctors(speciality: str = "general physician", city: str = "") -> dict[str, Any]:
    doctor, clinic, resolved = _doctor(speciality)
    return {
        "doctor_name": doctor,
        "speciality": resolved,
        "clinic": f"{clinic}{', ' + city if city else ''}",
        "next_slot": f"tomorrow, {9 + _stable(doctor, 8)}:30 AM",
        "slots_available": 1 + _stable(doctor, 5),
        "fee": "₹600" if resolved == "general physician" else "₹900",
    }


@router.post("/apollo/appointments")
async def apollo_book(payload: dict[str, Any]) -> dict[str, Any]:
    speciality = str(payload.get("speciality") or "general physician")
    when = str(payload.get("when") or "tomorrow")
    doctor, clinic, resolved = _doctor(speciality)
    seed = doctor + when
    return {
        "booking_ref": f"APL{_stable(seed, 900000) + 100000}",
        "doctor_name": doctor,
        "speciality": resolved,
        "clinic": clinic,
        "slot_time": f"{when}, {9 + _stable(seed, 8)}:30 AM",
        "slots_available": 1 + _stable(seed, 4),
        "fee": "₹600" if resolved == "general physician" else "₹900",
    }


@router.post("/apollo/appointments/{booking_ref}/cancel")
async def apollo_cancel(booking_ref: str) -> dict[str, Any]:
    if not booking_ref.upper().startswith("APL"):
        raise HTTPException(status_code=404, detail="I couldn't find a booking with that reference.")
    return {
        "booking_ref": booking_ref,
        "cancelled": True,
        "refund_note": "The consultation fee is fully refunded since it was cancelled in advance.",
    }
