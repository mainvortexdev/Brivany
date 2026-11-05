"""Atomic local budget accounting only; no provider billing or API."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from uuid import uuid4

from services.spatial.budget import SpatialBudget,BudgetError,micro_usd


class SpatialBudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.budget=SpatialBudget(Path(self.temp.name)/'budget.sqlite3')
    def configured(self,total='1',per_job='1',extra='0.1'):
        self.budget.configure(total_usd=total,per_job_usd=per_job,gpu_rate_usd_per_second='0.001',extra_reserve_usd=extra)
        return self.budget
    def test_default_blocks_without_inventing_prices(self):
        status=self.budget.status();self.assertFalse(status['configured']);self.assertIsNone(status['rate_usd_per_gpu_second'])
        self.assertTrue(status['new_reservations_blocked']);self.assertFalse(status['dispatch_enabled'])
        with self.assertRaises(BudgetError):self.budget.reserve(str(uuid4()),'0.1')
        with self.assertRaises(BudgetError):self.budget.estimate(5)
    def test_exact_micro_usd_and_estimation_require_explicit_rate_and_margin(self):
        budget=self.configured();estimate=budget.estimate(180)
        self.assertEqual(estimate['estimated_usd'],'0.180000');self.assertEqual(estimate['reserved_usd'],'0.280000')
        for value in (True,.1,'nan','Infinity','-1','0.0000001','1e999999999'):
            with self.assertRaises(BudgetError):micro_usd(value)
        self.assertEqual(micro_usd('0.000001'),1)
    def test_idempotent_reservation_and_conflicting_estimate(self):
        budget=self.configured();job=str(uuid4());first=budget.reserve(job,'0.3')
        self.assertEqual(first,budget.reserve(job,'0.300000'));self.assertEqual(budget.status()['reserved_micro_usd'],400000)
        with self.assertRaises(BudgetError):budget.reserve(job,'0.4')
        budget.cancel_before_start(job);budget.cancel_before_start(job)
        self.assertEqual(budget.status()['reserved_micro_usd'],0);self.assertEqual(budget.reserve(job,'0.3')['state'],'released')
    def test_concurrent_reservations_cannot_overbook(self):
        budget=self.configured(total='1',extra='0')
        def reserve(_):
            try:return budget.reserve(str(uuid4()),'0.3')['state']
            except BudgetError as error:return error.code
        with ThreadPoolExecutor(max_workers=8) as pool:out=list(pool.map(reserve,range(12)))
        self.assertEqual(out.count('reserved'),3);self.assertEqual(budget.status()['reserved_micro_usd'],900000)
        self.assertEqual(out.count('budget_exhausted'),9)
    def test_started_cancel_cannot_release_unknown_or_assume_zero(self):
        budget=self.configured();job=str(uuid4());budget.reserve(job,'0.2');budget.mark_started(job)
        with self.assertRaises(BudgetError):budget.cancel_before_start(job)
        unknown=budget.settle(job,None);self.assertIsNone(unknown['actual_usd']);self.assertEqual(unknown['state'],'unknown')
        self.assertEqual(budget.status()['reserved_usd'],'0.300000');self.assertEqual(budget.status()['unknown_count'],1)
        with self.assertRaises(BudgetError) as error:budget.reserve(str(uuid4()),'0.01')
        self.assertEqual(error.exception.code,'budget_unknown_cost')
        budget.settle(job,None);self.assertEqual(budget.status()['reserved_usd'],'0.300000')
        budget.settle(job,'0.25');self.assertEqual(budget.status()['reserved_usd'],'0.000000');self.assertEqual(budget.status()['spent_usd'],'0.250000')
        self.assertEqual(budget.status()['unknown_count'],0)
    def test_actual_bill_is_recorded_even_if_it_exceeds_reservation_or_total(self):
        budget=self.configured();job=str(uuid4());budget.reserve(job,'0.2');budget.mark_started(job)
        receipt=budget.settle(job,'1.25');self.assertTrue(receipt['actual_cost_known'])
        self.assertEqual(budget.status()['spent_usd'],'1.250000');self.assertEqual(budget.status()['available_usd'],'0.000000')
        self.assertFalse(budget.status()['external_billing_cap_guaranteed'])
        self.assertEqual(receipt,budget.settle(job,'1.250000'))
        with self.assertRaises(BudgetError):budget.settle(job,'1')
    def test_configuration_cannot_discard_committed_money_and_disable_blocks_new_work(self):
        budget=self.configured();job=str(uuid4());budget.reserve(job,'0.5')
        with self.assertRaises(BudgetError):budget.configure(total_usd='0.4',per_job_usd='0.3',gpu_rate_usd_per_second='0.001',extra_reserve_usd='0')
        budget.configure(total_usd='1',per_job_usd='0.7',gpu_rate_usd_per_second='0.001',extra_reserve_usd='0.1',enabled=False)
        with self.assertRaises(BudgetError):budget.reserve(str(uuid4()),'0.1')
        self.assertEqual(budget.status()['reserved_usd'],'0.600000')
    def test_persistence_and_prestart_release_are_distinct_from_billing(self):
        budget=self.configured(per_job='0.4');job=str(uuid4())
        with self.assertRaises(BudgetError):budget.reserve(job,'0.4')
        budget.reserve(job,'0.2');reopened=SpatialBudget(budget.path)
        with self.assertRaises(BudgetError):reopened.settle(job,'0')
        reopened.cancel_before_start(job);self.assertEqual(reopened.status()['spent_usd'],'0.000000')
        self.assertEqual(reopened.status()['reserved_usd'],'0.000000')


if __name__=='__main__':unittest.main()
