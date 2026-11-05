"""Manual selection invariants with synthetic manifests and image conversion stub."""
from copy import deepcopy
import hashlib
from io import BytesIO
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile
import zlib

from services.spatial.review import CaptureReviewService,CaptureReviewError,rectangle_mask
from services.spatial.capture import grayscale_metrics


class CaptureReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.capture_id=str(uuid4());self.folder=self.root/'captures'/self.capture_id
        (self.folder/'frames').mkdir(parents=True)
        # SOF metadata parser fixture; conversion is explicitly stubbed below.
        raw=b'\xff\xd8\xff\xc0'+struct.pack('>HBHHB',8,8,16,16,0)+b'\xff\xd9';digest=hashlib.sha256(raw).hexdigest()
        (self.folder/'frames/frame-0000.jpg').write_bytes(raw)
        document={'capture_id':self.capture_id,'source':{'filename':'synthetic.mp4','sha256':'a'*64,
            'size_bytes':40,'duration_seconds':1.0,'width':16,'height':16,'has_audio':False},'frames':[
            {'id':'frame-0000','relative_path':'frames/frame-0000.jpg','at_seconds':.5,'width':16,'height':16,'sha256':digest}]}
        (self.folder/'capture.json').write_text(json.dumps(document),encoding='utf-8')
        self.reviews=CaptureReviewService(self.root)
        self.item={'id':'object-1','label':'Mesa','frame_id':'frame-0000','frame_sha256':digest,
            'rectangle':{'x':.25,'y':.25,'width':.5,'height':.5},'mask_reviewed':False}

    def save(self,item=None,revision=0,reference=None):
        return self.reviews.save(self.capture_id,{'expected_revision':revision,'objects':[item or deepcopy(self.item)],'length_reference':reference})

    def test_manual_mask_is_binary_and_linked_to_exact_frame_without_metric_claim(self):
        result=self.save(reference={'description':'Ancho declarado de mesa','length_m':1.2})
        self.assertEqual(result['revision'],1);self.assertFalse(result['metric_scale_verified'])
        self.assertEqual(result['length_reference']['provenance'],'user_declared')
        raw,mime,name=self.reviews.mask(self.capture_id,'object-1')
        self.assertEqual(mime,'image/png');self.assertEqual(raw[:8],b'\x89PNG\r\n\x1a\n')
        offset=8;compressed=b''
        while offset<len(raw):
            count=struct.unpack('>I',raw[offset:offset+4])[0];kind=raw[offset+4:offset+8]
            if kind==b'IDAT':compressed+=raw[offset+8:offset+8+count]
            offset+=count+12
        pixels=zlib.decompress(compressed)
        self.assertEqual(set(pixels),{0,255});self.assertEqual(pixels.count(255),64)
        self.assertEqual(hashlib.sha256(raw).hexdigest(),result['objects'][0]['mask_sha256'])
        self.assertEqual(CaptureReviewService(self.root).get(self.capture_id)['objects'],result['objects'])

    def test_invalid_rectangle_objects_and_stale_revision_leave_review_unchanged(self):
        for rectangle in ({'x':-.1,'y':0,'width':.2,'height':.2},{'x':.8,'y':0,'width':.3,'height':.2},
            {'x':0,'y':0,'width':0,'height':.2},{'x':True,'y':0,'width':.2,'height':.2},
            {'x':float('nan'),'y':0,'width':.2,'height':.2}):
            item=deepcopy(self.item);item['rectangle']=rectangle
            with self.assertRaises(CaptureReviewError):self.save(item)
        with self.assertRaises(CaptureReviewError):
            self.reviews.save(self.capture_id,{'expected_revision':0,'objects':[self.item]*4,'length_reference':None})
        self.assertEqual(self.reviews.get(self.capture_id)['revision'],0)
        self.save()
        with self.assertRaises(CaptureReviewError) as error:self.save()
        self.assertEqual(error.exception.status,409)

    def test_frame_or_mask_tampering_and_path_escape_are_rejected(self):
        saved=self.save();digest=saved['objects'][0]['mask_sha256']
        mask=self.folder/'review/masks'/f'{digest}.png';mask.write_bytes(b'changed')
        with self.assertRaises(CaptureReviewError):self.reviews.mask(self.capture_id,'object-1')
        (self.folder/'frames/frame-0000.jpg').write_bytes(b'changed')
        with self.assertRaises(CaptureReviewError):self.reviews.get(self.capture_id)
        with self.assertRaises(CaptureReviewError):self.reviews.get('../.env')

    def test_imported_review_metadata_cannot_change_ids_or_verification_claims(self):
        saved=self.save()
        for change in ({'id':'object-1\nsecret'},{'rectangle':{'x':0,'y':0,'width':2,'height':1}}, {'frame_sha256':'b'*64}):
            bad=deepcopy(saved);bad.pop('quality');bad['objects'][0].update(change)
            with self.reviews._connect() as db:db.execute('UPDATE reviews SET document=?',(json.dumps(bad),))
            with self.assertRaises(CaptureReviewError):self.reviews.get(self.capture_id)

    def test_preparation_requires_review_and_preserves_hashes_and_unknown_dispatch(self):
        self.save()
        with self.assertRaises(CaptureReviewError):self.reviews.prepare(self.capture_id,{'expected_revision':1,'object_id':'object-1'})
        reviewed=deepcopy(self.item);reviewed['mask_reviewed']=True;self.save(reviewed,revision=1)
        image=rectangle_mask(16,16,{'x':0,'y':0,'width':1,'height':1})
        def convert(args,**kwargs):Path(args[-1]).write_bytes(image)
        with patch('services.spatial.review.shutil.which',return_value='ffmpeg'),patch('services.spatial.review._run',side_effect=convert) as converter:
            result=self.reviews.prepare(self.capture_id,{'expected_revision':2,'object_id':'object-1'})
            self.assertEqual(converter.call_count,1)
        self.assertEqual(result['status'],'prepared_not_executed');self.assertFalse(result['model_executed'])
        self.assertNotIn('reserved_usd',result);self.assertIn('approved_budget',result['pending'])
        raw,mime,name=self.reviews.package(self.capture_id,result['package_id'])
        with ZipFile(BytesIO(raw)) as package:
            self.assertEqual(set(package.namelist()),{'image.png','mask.png','provenance.json','README.txt'})
            self.assertEqual(hashlib.sha256(package.read('image.png')).hexdigest(),result['image_sha256'])
        path=self.folder/'review/packages'/f"{result['package_id']}.zip";path.write_bytes(b'corrupt')
        with self.assertRaises(CaptureReviewError):self.reviews.package(self.capture_id,result['package_id'])

    def test_image_signals_distinguish_exposure_texture_and_change_without_overlap_claim(self):
        dark=bytes([0])*64;bright=bytes([255])*64
        flat=grayscale_metrics(dark,8,8)
        changed=grayscale_metrics(bright,8,8,dark)
        textured=grayscale_metrics(bytes(255 if (x+y)%2 else 0 for y in range(8) for x in range(8)),8,8)
        self.assertEqual(flat['dark_fraction'],1);self.assertEqual(changed['bright_fraction'],1)
        self.assertEqual(changed['mean_absolute_change_from_previous'],255)
        self.assertGreater(textured['laplacian_variance'],flat['laplacian_variance'])
        self.assertNotIn('overlap',changed)


if __name__=='__main__':unittest.main()
