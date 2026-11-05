"""Progressive ASR clauses keep heard words stable across later revisions."""
import unittest

from packages.providers.inline_clauses import InlineClauses


class InlineClauseTests(unittest.TestCase):
    def setUp(self):
        self.clauses=InlineClauses()
        self.clauses.start('speaker-turn',0)
        self.source='One two three four five six seven eight nine ten eleven twelve.'

    def first_piece(self):
        self.assertIsNone(self.clauses.partial('speaker-turn',self.source,2200))
        piece=self.clauses.partial('speaker-turn',self.source,3000)
        self.assertIsNotNone(piece)
        return piece

    def test_repeated_partial_updates_cannot_emit_the_same_words_twice(self):
        piece=self.first_piece()
        self.assertEqual(piece.text,'One two three four five six seven eight')
        self.assertEqual(piece.chunk_id,'speaker-turn')
        for timestamp in (3000,3000,3200,3400):
            self.assertIsNone(self.clauses.partial('speaker-turn',self.source,timestamp))
        remainder=self.clauses.final('speaker-turn',self.source,10000)
        self.assertEqual(remainder.text,'nine ten eleven twelve.')
        self.assertEqual(remainder.start_ms,piece.end_ms)
        self.assertEqual(remainder.chunk_id,piece.next_id)

    def test_punctuation_and_case_cleanup_preserve_the_final_unheard_words(self):
        partial='The front door is open now. We can enter.'
        self.clauses.partial('speaker-turn',partial,2200)
        first=self.clauses.partial('speaker-turn',partial,3000)
        self.assertEqual(first.text,'The front door is open now.')
        final=self.clauses.final('speaker-turn','THE FRONT DOOR IS OPEN NOW! We can enter.',6000)
        self.assertEqual(final.text,'We can enter.')
        self.assertIsNone(final.skip_reason)

    def test_final_revision_of_heard_words_marks_only_the_unheard_interval(self):
        first=self.first_piece()
        final=self.clauses.final('speaker-turn','One changed three four five six seven eight nine ten eleven twelve.',10000)
        self.assertEqual(final.skip_reason,'asr_revision')
        self.assertEqual(final.text,'')
        self.assertEqual((final.start_ms,final.end_ms),(first.end_ms,10000))

    def test_invalid_timestamps_do_not_commit_or_close_a_turn(self):
        for timestamp in (-1,float('nan'),float('inf'),True,None):
            self.assertIsNone(self.clauses.partial('speaker-turn',self.source,timestamp))
            self.assertFalse(self.clauses.start('invalid',timestamp))
        self.assertEqual(self.clauses.current('speaker-turn'),('speaker-turn',0))
        self.assertEqual(self.clauses.final('speaker-turn',self.source,10000).timing_quality,'asr_turn')

    def test_a_short_revised_partial_waits_for_one_complete_final_turn(self):
        self.assertIsNone(self.clauses.partial('speaker-turn','The dog',1000))
        self.assertIsNone(self.clauses.partial('speaker-turn','The door',2300))
        final=self.clauses.final('speaker-turn','The door is open.',3000)
        self.assertEqual((final.text,final.timing_quality),('The door is open.','asr_turn'))
        self.assertIsNone(self.clauses.final('speaker-turn','The door is open.',3000))

    def test_estimated_boundaries_stay_within_observed_audio(self):
        first=self.first_piece()
        self.assertEqual(first.timing_quality,'asr_partial_estimate')
        self.assertGreater(first.end_ms,first.start_ms)
        self.assertGreaterEqual(first.end_ms-first.start_ms,1800)
        self.assertLessEqual(first.end_ms,2600)
        self.assertEqual(self.clauses.current('speaker-turn'),(first.next_id,first.end_ms))

    def test_canonical_accents_and_internal_apostrophes_preserve_the_final_remainder(self):
        cases=[
            ('El niño tenía café preparado para todos ahora. Podemos entrar juntos.',
             'El nin\u0303o teni\u0301a cafe\u0301 preparado para todos ahora. Podemos entrar juntos.'),
            ('They don’t want to leave this room yet. We can enter.',
             "They don't want to leave this room yet. We can enter.")]
        for partial,final_text in cases:
            with self.subTest(partial=partial):
                clauses=InlineClauses();clauses.start('1',0)
                clauses.partial('1',partial,2600)
                first=clauses.partial('1',partial,3600)
                self.assertIsNotNone(first)
                final=clauses.final('1',final_text,6000)
                self.assertIsNone(final.skip_reason)
                self.assertEqual(final.text,final_text.split('. ',1)[1])

    def test_accent_changes_that_alter_words_are_still_revisions(self):
        partial='El niño tenía café preparado para todos ahora. Podemos entrar juntos.'
        self.clauses.partial('speaker-turn',partial,2600)
        self.assertIsNotNone(self.clauses.partial('speaker-turn',partial,3600))
        final=self.clauses.final('speaker-turn','El nino tenía café preparado para todos ahora. Podemos entrar juntos.',6000)
        self.assertEqual(final.skip_reason,'asr_revision')

    def test_short_estimated_clause_waits_until_eighteen_hundred_ms_of_audio(self):
        partial='The door is open. We can enter the room now.'
        self.assertIsNone(self.clauses.partial('speaker-turn',partial,2200))
        self.assertIsNone(self.clauses.partial('speaker-turn',partial,2999))
        final=self.clauses.final('speaker-turn',partial,5000)
        self.assertEqual((final.text,final.timing_quality),(partial,'asr_turn'))

    def test_unpunctuated_seven_word_prefix_waits_until_remainder_is_three_seconds_old(self):
        text='Uno dos tres cuatro cinco seis siete ocho nueve diez'
        self.assertIsNone(self.clauses.partial('speaker-turn',text,2700))
        self.assertIsNone(self.clauses.partial('speaker-turn',text,2999))
        piece=self.clauses.partial('speaker-turn',text,3000)
        self.assertEqual(piece.text,'Uno dos tres cuatro cinco seis siete')
        self.assertEqual((piece.start_ms,piece.end_ms),(0,2100))
        self.assertEqual(piece.timing_quality,'asr_partial_estimate')
        final=self.clauses.final('speaker-turn',text,4300)
        self.assertEqual(final.text,'ocho nueve diez')
        self.assertEqual((piece.text+' '+final.text),text)

    def test_aged_small_prefix_still_needs_two_advancing_actual_partials(self):
        text='Uno dos tres cuatro cinco seis siete ocho nueve diez'
        self.assertIsNone(self.clauses.partial('speaker-turn',text,3000))
        self.assertIsNone(self.clauses.partial('speaker-turn',text,3000))
        self.assertIsNone(self.clauses.partial('speaker-turn',text,2999))
        piece=self.clauses.partial('speaker-turn',text,3100)
        self.assertEqual(piece.text,'Uno dos tres cuatro cinco seis siete')
        for timestamp in (3100,3100,3300,3500):
            self.assertIsNone(self.clauses.partial('speaker-turn',text,timestamp))
        self.assertEqual(self.clauses.final('speaker-turn',text,4300).text,'ocho nueve diez')

    def test_age_restarts_at_the_committed_piece_boundary_not_the_whole_turn(self):
        first=self.first_piece()
        text=self.source.rstrip('.')+' thirteen fourteen fifteen sixteen seventeen eighteen'
        self.assertEqual(first.end_ms,2000)
        self.assertIsNone(self.clauses.partial('speaker-turn',text,4600))
        self.assertIsNone(self.clauses.partial('speaker-turn',text,4999))
        piece=self.clauses.partial('speaker-turn',text,5000)
        self.assertEqual(piece.text,'nine ten eleven twelve thirteen fourteen fifteen')
        self.assertEqual((piece.start_ms,piece.end_ms),(2000,4100))
        final=self.clauses.final('speaker-turn',text,6500)
        self.assertEqual(final.text,'sixteen seventeen eighteen')
        self.assertEqual(' '.join((first.text,piece.text,final.text)),text)

    def test_four_to_seven_aged_words_keep_a_minimum_eighteen_hundred_ms_of_audio(self):
        cases=[('Uno dos tres cuatro cinco seis siete',3150,'Uno dos tres cuatro'),
               ('Uno dos tres cuatro cinco seis siete ocho',3000,'Uno dos tres cuatro cinco'),
               ('Uno dos tres cuatro cinco seis siete ocho nueve',3000,'Uno dos tres cuatro cinco seis')]
        for text,at,expected in cases:
            with self.subTest(text=text):
                clauses=InlineClauses();clauses.start('1',0)
                self.assertIsNone(clauses.partial('1',text,at-100))
                piece=clauses.partial('1',text,at)
                self.assertEqual(piece.text,expected)
                self.assertGreaterEqual(piece.end_ms-piece.start_ms,1800)
        clauses=InlineClauses();clauses.start('1',0)
        self.assertIsNone(clauses.partial('1',cases[0][0],2900))
        self.assertIsNone(clauses.partial('1',cases[0][0],3000),'Four of seven words would cover only1714ms')
        self.assertIsNone(clauses.partial('1','Uno dos tres cuatro cinco seis',4000),'Three retained words cannot leave fewer than four committed')

    def test_aged_stable_prefix_preserves_numbers_accents_and_late_revision_detection(self):
        text='No añadas -12,5 kg café aún seguimos con la prueba'
        self.assertIsNone(self.clauses.partial('speaker-turn',text,2900))
        piece=self.clauses.partial('speaker-turn',text,3300)
        self.assertEqual(piece.text,'No añadas -12,5 kg café aún seguimos')
        canonical='No an\u0303adas -12,5 kg cafe\u0301 au\u0301n seguimos con la prueba'
        final=self.clauses.final('speaker-turn',canonical,5000)
        self.assertEqual(final.text,'con la prueba')
        clauses=InlineClauses();clauses.start('1',0)
        clauses.partial('1',text,2900);first=clauses.partial('1',text,3300)
        changed=clauses.final('1',text.replace('-12,5','-12,6'),5000)
        self.assertEqual(changed.skip_reason,'asr_revision')
        self.assertEqual((changed.start_ms,changed.end_ms),(first.end_ms,5000))

    def test_changing_aged_words_cannot_be_treated_as_a_stable_prefix(self):
        self.assertIsNone(self.clauses.partial('speaker-turn','Uno dos tres cuatro cinco seis siete ocho nueve diez',3000))
        self.assertIsNone(self.clauses.partial('speaker-turn','Uno cambia tres cuatro cinco seis siete ocho nueve diez',3300))
        self.assertIsNone(self.clauses.partial('speaker-turn','Uno vuelve tres cuatro cinco seis siete ocho nueve diez',3600))


if __name__=='__main__':
    unittest.main()
