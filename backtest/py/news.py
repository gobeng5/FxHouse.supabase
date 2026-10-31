"""High-impact US news and NYSE calendar (official sources: federalreserve.gov, bls.gov, nyse.com).

All releases are 08:30 ET (CPI, NFP); FOMC decisions 14:00 ET.
October 2025 CPI and NFP were not published (government shutdown).
"""
from datetime import date

FOMC = {date(*d) for d in [
    (2025, 1, 29), (2025, 3, 19), (2025, 5, 7), (2025, 6, 18), (2025, 7, 30), (2025, 9, 17),
    (2025, 10, 29), (2025, 12, 10),
    (2026, 1, 28), (2026, 3, 18), (2026, 4, 29), (2026, 6, 17), (2026, 7, 29), (2026, 9, 16),
    (2026, 10, 28), (2026, 12, 9),
]}

CPI = {date(*d) for d in [
    (2025, 10, 24), (2025, 12, 18),
    (2026, 1, 13), (2026, 2, 13), (2026, 3, 11), (2026, 4, 10), (2026, 5, 12), (2026, 6, 10),
    (2026, 7, 14), (2026, 8, 12), (2026, 9, 11), (2026, 10, 14), (2026, 11, 10), (2026, 12, 10),
]}

NFP = {date(*d) for d in [
    (2025, 11, 20), (2025, 12, 16),
    (2026, 1, 9), (2026, 2, 11), (2026, 3, 6), (2026, 4, 3), (2026, 5, 8), (2026, 6, 5),
    (2026, 7, 2), (2026, 8, 7), (2026, 9, 4), (2026, 10, 2), (2026, 11, 6), (2026, 12, 4),
]}

NYSE_CLOSED = {date(*d) for d in [
    (2025, 11, 27), (2025, 12, 25),
    (2026, 1, 1), (2026, 1, 19), (2026, 2, 16), (2026, 4, 3), (2026, 5, 25), (2026, 6, 19),
    (2026, 7, 3), (2026, 9, 7), (2026, 11, 26), (2026, 12, 25),
]}

NYSE_HALF_DAY = {date(*d) for d in [(2025, 11, 28), (2025, 12, 24), (2026, 11, 27), (2026, 12, 24)]}


def release_times_utc():
    """Release instants (UTC): CPI and NFP 08:30 ET, FOMC decisions 14:00 ET."""
    import pandas as pd
    et = lambda d, h, m: pd.Timestamp(d.year, d.month, d.day, h, m, tz="America/New_York").tz_convert("UTC")
    return sorted([et(d, 8, 30) for d in CPI | NFP] + [et(d, 14, 0) for d in FOMC])


def news_day(d) -> str | None:
    """'FOMC day' / 'CPI day' / 'NFP day' for a calendar date, else None."""
    if d in FOMC: return "FOMC day"
    if d in CPI: return "CPI day"
    if d in NFP: return "NFP day"
    return None
