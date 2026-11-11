import pathlib
import sys
import unittest

import numpy as np

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'src'))
from source_origin import SourceOrigin


class SourceOriginTest(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(64)
        self.mic = rng.normal(0, .12, 32000).astype(np.float32)
        self.other = rng.normal(0, .008, 32000).astype(np.float32)

    def classify(self, computer=None, aligned=None, start=.8, end=.9):
        audio = dict(microphone=self.mic, computer=self.other if computer is None else computer)
        return SourceOrigin(audio, aligned or {}).evidence('microphone', start, end)

    def test_dominant_microphone_with_background_energy(self):
        evidence = self.classify()
        self.assertEqual(evidence['confidence'], 'probable')
        self.assertFalse(evidence['overlap'])

    def test_simultaneous_recognized_speech_is_separate_from_independent_channel_evidence(self):
        evidence = self.classify(aligned={'computer': {'segments': [
            {'start': .7, 'end': 1.1, 'words': [{'start': .8, 'end': .95}]}]}})
        self.assertTrue(evidence['overlap'])
        self.assertTrue(evidence['localCandidate'])

    def test_comparable_energy_does_not_override_low_reference_match(self):
        evidence = self.classify(self.other * 12)
        self.assertTrue(evidence['energyAmbiguous'])
        self.assertFalse(evidence['overlap'])
        self.assertTrue(evidence['localCandidate'])

    def test_quiet_concurrent_speech_does_not_identify_a_person(self):
        aligned = {'computer': {'segments': [{'start': .7, 'end': 1.1}]}}
        evidence = self.classify(self.other * .25, aligned=aligned)
        self.assertTrue(evidence['overlap'])
        self.assertTrue(evidence['localCandidate'])
        self.assertEqual(evidence['identityEvidence'], 'none')

    def test_energy_ambiguity_is_channel_evidence_not_remote_identity(self):
        audio = {'microphone': self.mic, 'computer': self.other * 12}
        evidence = SourceOrigin(audio, {}).evidence('computer', .8, .9)
        self.assertTrue(evidence['energyAmbiguous'])
        self.assertFalse(evidence['overlap'])
        self.assertFalse(evidence['echoRisk'])

    def test_delayed_echo_remains_uncertain_even_when_dominant(self):
        echo = np.concatenate([np.zeros(960), self.mic[:-960]]) * .1
        evidence = self.classify(echo)
        self.assertTrue(evidence['echoRisk'])
        self.assertFalse(evidence['localCandidate'])

    def test_short_token_dip_uses_context(self):
        self.mic[12800:12960] = 0
        self.assertTrue(self.classify(start=.8, end=.81)['localCandidate'])

    def test_silence_and_truncated_audio_abstain(self):
        self.mic[:] = 0
        self.assertFalse(self.classify()['localCandidate'])
        self.assertFalse(self.classify(start=3, end=3.1)['localCandidate'])

    def test_source_only_is_not_biometric(self):
        result = SourceOrigin({'microphone': self.mic}, {}).evidence('microphone', .8, .9)
        self.assertEqual(result['confidence'], 'source-only')

    def test_inputs_are_unchanged(self):
        aligned = {'computer': {'segments': [{'start': .8, 'end': 1, 'text': 'fixture'}]}}
        import copy
        previous = copy.deepcopy(aligned)
        mic, other = self.mic.copy(), self.other.copy()
        self.classify(aligned=aligned)
        self.assertEqual(aligned, previous)
        np.testing.assert_array_equal(self.mic, mic)
        np.testing.assert_array_equal(self.other, other)


if __name__ == '__main__':
    unittest.main()
