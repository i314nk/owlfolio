"""Output schemas for specialist subagents.

Each specialist returns structured findings validated through these schemas.
The synthesis agent receives all specialist outputs to make the final decision.
"""

from pydantic import BaseModel


class SpecialistFindings(BaseModel):
    """Base schema for all specialist outputs."""

    specialist_name: str
    ticker: str
    summary: str  # 2-3 sentence summary of findings
    key_findings: list[str]  # Bullet points
    data_sources: list[str]  # URLs/sources used
    confidence: float = 0.7  # 0-1 how confident in the findings
    flags: list[str] = []  # Red/yellow/green flags


class FinancialFindings(SpecialistFindings):
    """Financial analyst output."""

    revenue: float | None = None
    net_income: float | None = None
    free_cash_flow: float | None = None
    owner_earnings: float | None = None
    debt_level: str = "unknown"  # fortress/conservative/moderate/leveraged/distressed
    sbc_as_pct_revenue: float | None = None
    margins: dict[str, float] = {}  # gross_margin, operating_margin, net_margin
    growth_rates: dict[str, float] = {}  # 1yr, 3yr, 5yr revenue/earnings growth
    one_time_items: list[str] = []


class MoatFindings(SpecialistFindings):
    """Moat/quality analyst output."""

    criteria_scores: dict[str, float] = {}  # {"switching_costs": 4.2, ...}
    weighted_score: float = 0.0
    tier: str = "unknown"  # strategy-defined tier name
    moat_trajectory: str = "unknown"  # widening/stable/narrowing
    key_competitors: list[str] = []
    competitive_position: str = ""


class RiskFindings(SpecialistFindings):
    """Risk analyst output."""

    risks: list[dict] = []  # [{name, severity, probability, description}]
    overall_risk_level: str = "moderate"  # low/moderate/high/critical
    regulatory_exposure: str = ""
    concentration_risks: list[str] = []


class ManagementFindings(SpecialistFindings):
    """Management analyst output."""

    score: int = 3  # 1-5
    insider_ownership: str = ""
    capital_allocation: str = ""
    compensation_notes: str = ""
    red_flags: list[str] = []
    green_flags: list[str] = []


class MentalModelFindings(SpecialistFindings):
    """Mental models output."""

    model_results: list[dict] = []  # [{name, assessment, verdict: PASS/CONCERN/FAIL}]
    has_hard_gate_failure: bool = False


class SynthesisResult(BaseModel):
    """Synthesis agent's final analysis result."""

    ticker: str
    company_name: str
    strategy: str

    # Valuation
    fair_value: float | None = None  # Buy price / fair value / PEG fair value
    current_price: float | None = None
    valuation_reasoning: str = ""

    # Quality assessment
    quality_tier: str = "unknown"  # Based on strategy criteria
    weighted_score: float = 0.0
    criteria_scores: dict[str, float] = {}

    # Decision
    decision: str = "WATCH"  # BUY / WATCH / PASS
    confidence: float = 0.5
    reasoning: str = ""

    # Thesis
    thesis: str = ""
    bull_case: str = ""
    bear_case: str = ""
    key_risks: list[str] = []
    catalysts: list[str] = []

    # Position sizing recommendation
    recommended_position_pct: float | None = None
    tranche: str | int | None = None

    # Metadata
    specialists_used: list[str] = []
    data_sources: list[str] = []
    discrepancies: list[str] = []  # Conflicting data between specialists
