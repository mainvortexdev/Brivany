"""Atomic local reservations for a future remote worker; never dispatches work.

Amounts are integer micro-USD in SQLite. Unknown billing retains its hold and
blocks new work; a reservation is not a hard cap on an external provider bill.
"""
from __future__ import annotations
from contextlib import contextmanager
from decimal import Decimal, DecimalException
from pathlib import Path
import sqlite3
from uuid import UUID

MICROS=1_000_000
MAX_MICROS=1_000_000_000_000


class BudgetError(ValueError):
    def __init__(self,code,message,status=409):
        self.code,self.status=code,status;super().__init__(message)


def micro_usd(value,*,positive=False):
    if isinstance(value,bool) or not isinstance(value,(str,int,Decimal)):
        raise BudgetError("budget_amount","Usa importes decimales exactos en USD.",422)
    try:
        number=Decimal(value)
        amount=number*MICROS
        if not number.is_finite() or amount!=amount.to_integral_value() or amount<0 or amount>MAX_MICROS or positive and amount<=0:
            raise ValueError()
        return int(amount)
    except (ValueError,DecimalException,OverflowError):
        raise BudgetError("budget_amount","El importe debe ser finito y admitir precisión de micro-USD.",422) from None


def usd(value):return f"{value//MICROS}.{value%MICROS:06d}"


def job_key(value):
    try:
        if not isinstance(value,str) or str(UUID(value))!=value:raise ValueError()
    except ValueError:raise BudgetError("budget_job","El trabajo necesita un UUID válido.",422) from None
    return value


class SpatialBudget:
    def __init__(self,path):
        self.path=Path(path).absolute()
        if self.path.resolve()!=self.path:raise BudgetError("budget_storage","La ruta de presupuesto no puede redirigirse.",422)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self._transaction() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS budget_config(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER,total INTEGER,per_job INTEGER,rate INTEGER,extra INTEGER);
            CREATE TABLE IF NOT EXISTS reservations(job_id TEXT PRIMARY KEY,estimate INTEGER,reserved INTEGER,state TEXT,actual INTEGER);
            CREATE TABLE IF NOT EXISTS budget_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT,action TEXT,amount INTEGER,recorded_at TEXT DEFAULT CURRENT_TIMESTAMP);
            """)

    @contextmanager
    def _transaction(self):
        db=sqlite3.connect(self.path,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            if db.in_transaction:db.execute("COMMIT")
        except Exception:
            if db.in_transaction:db.execute("ROLLBACK")
            raise
        finally:db.close()

    @staticmethod
    def _totals(db):
        row=db.execute("SELECT coalesce(sum(CASE WHEN state IN ('reserved','started','unknown') THEN reserved ELSE 0 END),0) AS held,coalesce(sum(CASE WHEN state='settled' THEN actual ELSE 0 END),0) AS spent,coalesce(sum(CASE WHEN state='unknown' THEN 1 ELSE 0 END),0) AS unknown_count FROM reservations").fetchone()
        return dict(row)

    def configure(self,*,total_usd,per_job_usd,gpu_rate_usd_per_second,extra_reserve_usd,enabled=True):
        if type(enabled) is not bool:raise BudgetError("budget_config","enabled debe ser booleano.",422)
        total=micro_usd(total_usd,positive=True);per_job=micro_usd(per_job_usd,positive=True)
        rate=micro_usd(gpu_rate_usd_per_second,positive=True);extra=micro_usd(extra_reserve_usd)
        if per_job>total:raise BudgetError("budget_config","El límite por trabajo no puede superar el total.",422)
        with self._transaction() as db:
            totals=self._totals(db)
            if total<totals['held']+totals['spent']:raise BudgetError("budget_committed","El total no puede quedar por debajo de gastos y reservas existentes.")
            db.execute("INSERT OR REPLACE INTO budget_config VALUES(1,?,?,?,?,?)",(int(enabled),total,per_job,rate,extra))
            db.execute("INSERT INTO budget_events(job_id,action,amount) VALUES(NULL,'configure',?)",(total,))
        return self.status()

    def estimate(self,gpu_seconds):
        if type(gpu_seconds) is not int or not 1<=gpu_seconds<=900:raise BudgetError("budget_duration","La estimación requiere entre 1 y 900 segundos GPU.",422)
        with self._transaction() as db:
            config=db.execute("SELECT * FROM budget_config WHERE id=1").fetchone()
            if config is None:raise BudgetError("budget_unconfigured","Falta configurar tarifa y límites explícitos.")
            amount=config['rate']*gpu_seconds;reserved=amount+config['extra']
            return {"gpu_seconds":gpu_seconds,"estimated_micro_usd":amount,"estimated_usd":usd(amount),
                "reserved_micro_usd":reserved,"reserved_usd":usd(reserved),"rate_usd_per_gpu_second":usd(config['rate']),
                "extra_reserve_usd":usd(config['extra']),"actual_cost_known":False,"dispatch_enabled":False}

    @staticmethod
    def _receipt(row):
        return {"job_id":row['job_id'],"state":row['state'],"estimated_micro_usd":row['estimate'],"estimated_usd":usd(row['estimate']),
            "reserved_micro_usd":row['reserved'],"reserved_usd":usd(row['reserved']),
            "actual_micro_usd":row['actual'],"actual_usd":usd(row['actual']) if row['actual'] is not None else None,
            "actual_cost_known":row['actual'] is not None,"dispatch_enabled":False}

    def reserve(self,job_id,estimated_usd):
        job_key(job_id);estimate=micro_usd(estimated_usd,positive=True)
        with self._transaction() as db:
            existing=db.execute("SELECT * FROM reservations WHERE job_id=?",(job_id,)).fetchone()
            if existing:
                if existing['estimate']!=estimate:raise BudgetError("budget_conflict","El trabajo ya tiene una estimación diferente.")
                return self._receipt(existing)
            config=db.execute("SELECT * FROM budget_config WHERE id=1").fetchone()
            if config is None or not config['enabled']:raise BudgetError("budget_disabled","El presupuesto aún no está habilitado.")
            totals=self._totals(db)
            if totals['unknown_count']:raise BudgetError("budget_unknown_cost","Hay un consumo desconocido pendiente de conciliar.")
            reserved=estimate+config['extra']
            if reserved>config['per_job']:raise BudgetError("budget_per_job","La reserva excede el límite por trabajo.")
            if totals['held']+totals['spent']+reserved>config['total']:raise BudgetError("budget_exhausted","El presupuesto disponible no alcanza para este trabajo.")
            db.execute("INSERT INTO reservations VALUES(?,?,?,'reserved',NULL)",(job_id,estimate,reserved))
            db.execute("INSERT INTO budget_events(job_id,action,amount) VALUES(?,'reserve',?)",(job_id,reserved))
            return self._receipt(db.execute("SELECT * FROM reservations WHERE job_id=?",(job_id,)).fetchone())

    def _change(self,job_id,action,actual=None):
        job_key(job_id)
        with self._transaction() as db:
            row=db.execute("SELECT * FROM reservations WHERE job_id=?",(job_id,)).fetchone()
            if not row:raise BudgetError("budget_reservation_missing","El trabajo no tiene una reserva.",404)
            state=row['state'];next_state=state
            if action=='start':
                if state not in {'reserved','started'}:raise BudgetError("budget_conflict","Una reserva finalizada no puede empezar de nuevo.")
                next_state='started'
            elif action=='release':
                if state not in {'reserved','released'}:raise BudgetError("budget_started","Un trabajo iniciado conserva su reserva hasta conocer el consumo.")
                next_state='released'
            else:
                if state=='settled':
                    if actual is None or row['actual']!=actual:raise BudgetError("budget_conflict","El consumo ya se concilió con otro importe.")
                    return self._receipt(row)
                if state not in {'started','unknown'}:raise BudgetError("budget_not_started","Solo se concilian trabajos que empezaron.")
                next_state='unknown' if actual is None else 'settled'
            if state!=next_state:
                db.execute("UPDATE reservations SET state=?,actual=? WHERE job_id=?",(next_state,actual if next_state=='settled' else None,job_id))
                db.execute("INSERT INTO budget_events(job_id,action,amount) VALUES(?,?,?)",(job_id,next_state,actual))
            return self._receipt(db.execute("SELECT * FROM reservations WHERE job_id=?",(job_id,)).fetchone())

    def mark_started(self,job_id):return self._change(job_id,'start')
    def cancel_before_start(self,job_id):return self._change(job_id,'release')
    def settle(self,job_id,actual_usd):return self._change(job_id,'settle',None if actual_usd is None else micro_usd(actual_usd))

    def status(self):
        with self._transaction() as db:
            config=db.execute("SELECT * FROM budget_config WHERE id=1").fetchone();totals=self._totals(db)
            total=config['total'] if config else None
            available=max(0,total-totals['held']-totals['spent']) if total is not None else None
            return {"configured":config is not None,"enabled":bool(config and config['enabled']),"dispatch_enabled":False,
                "total_micro_usd":total,"total_usd":usd(total) if total is not None else None,
                "per_job_usd":usd(config['per_job']) if config else None,"rate_usd_per_gpu_second":usd(config['rate']) if config else None,
                "extra_reserve_usd":usd(config['extra']) if config else None,
                "reserved_micro_usd":totals['held'],"reserved_usd":usd(totals['held']),"spent_micro_usd":totals['spent'],"spent_usd":usd(totals['spent']),
                "unknown_count":totals['unknown_count'],"available_micro_usd":available,"available_usd":usd(available) if available is not None else None,
                "new_reservations_blocked":config is None or not config['enabled'] or totals['unknown_count']>0 or not available,
                "external_billing_cap_guaranteed":False}
