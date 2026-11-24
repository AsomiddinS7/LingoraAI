import unittest
from types import SimpleNamespace
import numpy as np
from train_temporal import augment,audit_dataset
from train_skeletal import descriptors,activity_vectors

class ExpandedTrainingTests(unittest.TestCase):
    def sample(self):
        x = np.zeros((3,32,128), dtype=np.float32)
        x[:,:,0] = 1
        for j in range(21):
            x[:,:,1+j*3] = .1 + .01*j + np.arange(32)[None,:]*.005
            x[:,:,2+j*3] = .2 + .015*j
            x[:,:,3+j*3] = .003*j
        x[0,10:16,:64] = 0
        return x

    def test_robust_augmentation_preserves_censored_coordinate_masks(self):
        x = self.sample()
        clean, noisy = augment(np.repeat(x,32,axis=0), np.random.default_rng(8), robust=True)
        self.assertTrue(np.isfinite(clean).all() and np.isfinite(noisy).all())
        for data in (clean,noisy):
            for offset in (0,64):
                missing = data[:,:,offset] == 0
                self.assertTrue(np.all(data[:,:,offset+1:offset+64][missing] == 0))
                self.assertTrue(np.isin(data[:,:,offset], [0,1]).all())
        self.assertFalse(np.array_equal(clean, np.repeat(x,32,axis=0)))

    def test_descriptors_keep_global_location_and_temporal_order(self):
        x = self.sample()[1:]
        y = x.copy(); y[:,:,1:64] *= 2
        a,b = descriptors(x), descriptors(y)
        self.assertEqual(a.shape, (2,768))
        np.testing.assert_allclose(a[:,4:64],b[:,4:64],atol=1e-6)
        self.assertFalse(np.allclose(a, descriptors(x[:,::-1])))

    def test_empty_observations_have_no_geometric_features(self):
        self.assertTrue(np.all(descriptors(np.zeros((2,32,128))) == 0))

    def test_activity_features_keep_missingness_and_original_view(self):
        x=self.sample();focused=activity_vectors(x)
        for offset in (0,64):
            self.assertTrue(np.all(focused[:,:,offset+1:offset+64][focused[:,:,offset]==0]==0))
        full,both=descriptors(x),descriptors(x,True)
        self.assertEqual(both.shape,(3,1536))
        np.testing.assert_array_equal(full,both[:,:768])

    def test_augmented_training_views_never_allow_cross_split_source_overlap(self):
        def example(identifier,split):
            x=self.sample()[1].copy();x[:,1]+=len(identifier)*.001
            return {'id':identifier,'label':'help','split':split,'vectors':x.tolist(),'source_key':'recording',
                'source_start_ms':1000,'source_end_ms':2000,'base_reference_id':'same-real-performance'}
        data={'format':'lingora-normalized-training-v1','frames':32,'features':128,'labels':['help'],
            'examples':[example('first','train'),example('second-view','train')]}
        audit=audit_dataset(data,SimpleNamespace(read_bytes=lambda:b'unit-fixture'))
        self.assertEqual(len(audit['training_augmentation_pairs']),1)
        data['examples'][1]['split']='regression'
        with self.assertRaises(AssertionError):audit_dataset(data,SimpleNamespace(read_bytes=lambda:b'unit-fixture'))

if __name__ == '__main__':
    unittest.main()
