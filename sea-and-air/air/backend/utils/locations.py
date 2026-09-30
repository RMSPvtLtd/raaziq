"""Canonical commercial route labels; legacy names remain matchable.

Unknown locations must be entered as codes. This is an input-format check,
not a claim that every three-letter combination is an assigned airport.
"""
import re


CITY_CODES = {
    "LAHORE": "LHE", "DUBAI": "DXB", "LONDON": "LHR", "LONDON HEATHROW": "LHR",
    "HEATHROW": "LHR", "KARACHI": "KHI", "ISLAMABAD": "ISB", "DOHA": "DOH",
    "ISTANBUL": "IST", "COLOMBO": "CMB", "HANOI": "HAN", "ABU DHABI": "AUH",
    "SINGAPORE": "SIN", "FRANKFURT": "FRA", "MANCHESTER": "MAN",
    "LAHORE, PAKISTAN": "LHE", "KARACHI, PAKISTAN": "KHI",
    "DUBAI, UNITED ARAB EMIRATES": "DXB", "LONDON, UNITED KINGDOM": "LHR",
}


def location_code(value: str) -> str:
    value = value.strip().upper()
    return CITY_CODES.get(value, value)


def location_aliases(value: str) -> list[str]:
    code = location_code(value)
    return [code, *(name for name, target in CITY_CODES.items() if target == code)]


def validate_location(value: str, mode: str) -> str:
    code = location_code(value) if mode == "air" else value.strip().upper()
    if mode == "air" and not re.fullmatch(r"[A-Z]{3}", code):
        raise ValueError("Use a three-letter airport code, for example LHE, DXB or LHR")
    if not code:
        raise ValueError("Location is required")
    return code


def carrier_name(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip().upper()
    return {"EK": "EMIRATES", "EMIRATES AIRLINE": "EMIRATES", "EMIRATES AIRLINES": "EMIRATES",
            "EMIRATES SKYCARGO": "EMIRATES", "TK": "TURKISH AIRLINES", "TURKISH": "TURKISH AIRLINES",
            "TURKING": "TURKISH AIRLINES", "QR": "QATAR AIRWAYS", "QATAR": "QATAR AIRWAYS"}.get(value, value) or None
