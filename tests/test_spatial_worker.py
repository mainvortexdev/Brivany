"""Prepared worker boundaries, fake model process only; no cloud or CUDA."""
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import Mock, patch
from uuid import uuid4
import zlib

from workers import spatial_runtime as runtime
from workers.spatial_modal import create_app, function_options
from tools.check_spatial_worker import check


def png():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind+data))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\0"+b"\0\xff\0\xff"*4)) + chunk(b"IEND", b"")


def request():
    data=png();digest=hashlib.sha256(data).hexdigest()
    return {"schema_version":"0.1.0","job_id":str(uuid4()),"capture_id":str(uuid4()),"frame_id":"frame-0001",
        "image_png":data,"image_sha256":digest,"mask_png":data,"mask_sha256":digest,
        "mask_reviewed":True,"seed":42,"timeout_seconds":10,"reserved_usd":.5}


def glb():
    binary=struct.pack("<9f3H",0,0,0,1,0,0,0,1,0,0,1,2); binary+=b"\0"*((-len(binary))%4)
    model={"asset":{"version":"2.0"},"buffers":[{"byteLength":42}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":6}],
        "accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3"},
            {"bufferView":1,"componentType":5123,"count":3,"type":"SCALAR"}],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}]}
    text=json.dumps(model,separators=(",",":")).encode(); text+=b" "*((-len(text))%4)
    chunks=struct.pack("<II",len(text),0x4e4f534a)+text+struct.pack("<II",len(binary),0x004e4942)+binary
    return struct.pack("<III",0x46546c67,2,12+len(chunks))+chunks


class SpatialWorkerTests(unittest.TestCase):
    def test_shipped_lock_prevents_declaration_and_execution_before_sdk_or_filesystem(self):
        lock=runtime.read_lock()
        self.assertFalse(runtime.readiness(lock)["remote_dispatch_enabled"])
        self.assertIn("checkpoint_hashes_pending",runtime.readiness(lock)["pending"])
        with patch("workers.spatial_modal.importlib.metadata.version") as version:
            with self.assertRaises(runtime.SpatialWorkerError):create_app()
            version.assert_not_called()
        with tempfile.TemporaryDirectory() as directory:
            workspace=Path(directory)/"not-created"
            with self.assertRaises(runtime.SpatialWorkerError) as error:runtime.execute(request(),workspace,Path(directory)/"weights")
            self.assertEqual(error.exception.code,"worker_not_configured");self.assertFalse(workspace.exists())

    def test_offline_compilation_and_resource_limits(self):
        report=check();self.assertEqual(report["status"],"passed")
        self.assertEqual(report["external_calls"],0);self.assertFalse(report["modal_deployed"])
        options=function_options(runtime.read_lock())
        self.assertEqual((options["min_containers"],options["max_containers"],options["retries"],options["timeout"]),(0,1,0,180))
        for name,value in (("max_containers",2),("retries",1),("timeout_seconds",181),("gpu","H100")):
            lock=runtime.read_lock();lock["modal"][name]=value
            with self.assertRaises(runtime.SpatialWorkerError):function_options(lock)

    def test_payload_requires_reviewed_same_size_hashed_input_and_no_commands(self):
        self.assertEqual(runtime.validate_request(request()),(4,4))
        for changes in ({"mask_reviewed":False},{"image_sha256":"0"*64},{"mask_png":b"invalid"},
            {"seed":True},{"timeout_seconds":181},{"reserved_usd":0},{"reserved_usd":float("nan")},
            {"image_png":"https://private.invalid/image.png"},{"command":"run anything"},{"frame_id":"../image"}):
            value=request();value.update(changes)
            with self.subTest(changes=list(changes)):
                with self.assertRaises(runtime.SpatialWorkerError):runtime.validate_request(value)

    def test_budget_unknown_or_insufficient_stays_blocked_and_estimate_not_invoice(self):
        lock=runtime.read_lock()
        with self.assertRaises(runtime.SpatialWorkerError):runtime.budget_estimate(lock,10)
        lock["budget"]={"approved_per_job_usd":.5,"approved_total_usd":1.,"gpu_rate_usd_per_second":.001,"non_gpu_reserve_per_job_usd":.1}
        self.assertAlmostEqual(runtime.budget_estimate(lock,10),.11)
        lock["budget"]["approved_per_job_usd"]=.1
        with self.assertRaises(runtime.SpatialWorkerError):runtime.budget_estimate(lock,10)

    def test_weights_require_complete_tree_hashes_and_no_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/"pipeline.yaml").write_bytes(b"fixed-config")
            manifest=[{"path":"pipeline.yaml","sha256":hashlib.sha256(b"fixed-config").hexdigest(),"size_bytes":12}]
            self.assertEqual(runtime.verify_weight_tree(root,manifest),1)
            for path in ("../pipeline.yaml","/pipeline.yaml","C:/pipeline.yaml","dir\\pipeline.yaml","./pipeline.yaml"):
                with self.assertRaises(runtime.SpatialWorkerError):runtime.verify_weight_tree(root,[{**manifest[0],"path":path}])
            (root/"extra.pt").write_bytes(b"unlisted")
            with self.assertRaises(runtime.SpatialWorkerError):runtime.verify_weight_tree(root,manifest)
            (root/"extra.pt").unlink();(root/"pipeline.yaml").write_bytes(b"wrong-config")
            with self.assertRaises(runtime.SpatialWorkerError):runtime.verify_weight_tree(root,manifest)

    def test_source_revision_requires_clean_checkout_and_matching_file(self):
        lock=runtime.read_lock()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/"fixed.py").write_bytes(b"fixed")
            lock["sam3d_source_files"]={"fixed.py":{"sha256":hashlib.sha256(b"fixed").hexdigest()}}
            revision=lock["models"]["sam3d_objects"]["code_revision"]
            clean=Mock(returncode=0,stdout=b"");head=Mock(returncode=0,stdout=revision.encode())
            with patch("workers.spatial_runtime.subprocess.run",side_effect=[head,clean]):runtime.verify_model_code(root,lock)
            with patch("workers.spatial_runtime.subprocess.run",side_effect=[head,Mock(stdout=b" M fixed.py")]):
                with self.assertRaises(runtime.SpatialWorkerError):runtime.verify_model_code(root,lock)

    def test_glb_rejects_wrong_headers_external_uris_and_out_of_bounds_views(self):
        content=glb();info=runtime.validate_glb(content)
        self.assertTrue(info["structure_checks_passed"]);self.assertFalse(info["geometry_fidelity_verified"])
        self.assertEqual(info["validation_scope"],"glb_header_chunks_buffer_ranges_accessors_self_contained")
        for changed in (content[:-4],b"bad "+content[4:],content[:4]+struct.pack("<I",1)+content[8:]):
            with self.assertRaises(runtime.SpatialWorkerError):runtime.validate_glb(changed)
        def rebuild(mutate):
            length=struct.unpack("<I",content[12:16])[0]
            value=json.loads(content[20:20+length]);mutate(value)
            data=json.dumps(value,separators=(",",":")).encode();data+=b" "*((-len(data))%4)
            tail=content[20+length:];chunks=struct.pack("<II",len(data),0x4e4f534a)+data+tail
            return struct.pack("<III",0x46546c67,2,len(chunks)+12)+chunks
        for mutate in (lambda d:d["buffers"][0].update(uri="https://external.invalid/data"),
                       lambda d:d["bufferViews"][0].update(byteLength=99999),
                       lambda d:d["accessors"][0].update(count=999999),
                       lambda d:d["meshes"][0]["primitives"][0]["attributes"].update(POSITION=99)):
            with self.assertRaises(runtime.SpatialWorkerError):runtime.validate_glb(rebuild(mutate))

    def configured_lock(self,weights):
        lock=runtime.read_lock();lock["remote_dispatch_enabled"]=True
        lock["runtime"].update(dependency_lock_complete=True,build_verified=True,cuda_compatibility_verified=True,
            base_image_digest="sha256:"+"a"*64,checkpoint_manifest=[{"path":"pipeline.yaml","sha256":hashlib.sha256(b"fixed-config").hexdigest(),"size_bytes":12}])
        lock["models"]["sam3d_objects"].update(checkpoint_revision="a"*40,checkpoint_hashes_verified=True,license_reviewed_by_user=True)
        lock["budget"]={"approved_per_job_usd":.5,"approved_total_usd":1.,"gpu_rate_usd_per_second":.001,"non_gpu_reserve_per_job_usd":.1}
        weights.mkdir();(weights/"pipeline.yaml").write_bytes(b"fixed-config")
        return lock

    def test_fake_result_publishes_only_complete_output_and_reuses_cache_for_new_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);weights=root/"weights";workspace=root/"results";lock=self.configured_lock(weights)
            value=request()
            def model(job,*_args):
                (job/"object.glb").write_bytes(glb());(job/"private-runner.log").write_text("private input path")
            with patch("workers.spatial_runtime.verify_model_code"),patch("workers.spatial_runtime._run_model_process",side_effect=model) as run:
                first=runtime.execute(value,workspace,weights,lock=lock)
                another={**value,"capture_id":str(uuid4()),"job_id":str(uuid4()),"frame_id":"frame-0002"}
                second=runtime.execute(another,workspace,weights,lock=lock)
                self.assertEqual(run.call_count,1)
            self.assertFalse(first["cache_hit"]);self.assertTrue(second["cache_hit"])
            self.assertEqual(first["artifact_bytes"],second["artifact_bytes"])
            self.assertEqual(second["source_capture_id"],another["capture_id"])
            self.assertEqual(second["source_frame_id"],another["frame_id"])
            self.assertFalse(second["model_executed_this_call"]);self.assertIsNone(second["actual_billed_usd"])
            stored=list(workspace.iterdir());self.assertEqual(len(stored),1)
            self.assertEqual(sorted(p.name for p in stored[0].iterdir()),["object.glb","result.json"])

    def test_failure_cancel_and_budget_do_not_publish_or_retain_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);weights=root/"weights";workspace=root/"results";lock=self.configured_lock(weights)
            with patch("workers.spatial_runtime.verify_model_code"),patch("workers.spatial_runtime._run_model_process",side_effect=runtime.SpatialWorkerError("worker_timeout","fixed")):
                with self.assertRaises(runtime.SpatialWorkerError):runtime.execute(request(),workspace,weights,lock=lock)
            self.assertEqual(list(workspace.iterdir()),[])
            with self.assertRaises(runtime.SpatialWorkerError) as error:runtime.execute(request(),workspace,weights,lock=lock,cancelled=lambda:True)
            self.assertEqual(error.exception.code,"worker_cancelled")
            with self.assertRaises(runtime.SpatialWorkerError):runtime.execute({**request(),"reserved_usd":.01},workspace,weights,lock=lock)

    def test_process_timeout_kills_only_fixed_runner_and_never_reflects_private_logs(self):
        process=Mock();process.poll.return_value=None;process.returncode=None
        with tempfile.TemporaryDirectory() as directory,patch("workers.spatial_runtime.subprocess.Popen",return_value=process) as spawn:
            with self.assertRaises(runtime.SpatialWorkerError) as error:
                runtime._run_model_process(Path(directory),Path(directory),Path(directory),0,lambda:False)
            self.assertEqual(error.exception.code,"worker_timeout");process.kill.assert_called_once()
            command=spawn.call_args.args[0];self.assertIn("workers.sam3d_runner",command)
            self.assertNotIn("shell",spawn.call_args.kwargs)

    def test_process_cancel_kills_the_fixed_runner_before_it_can_publish(self):
        process=Mock();process.poll.return_value=None
        with tempfile.TemporaryDirectory() as directory,patch("workers.spatial_runtime.subprocess.Popen",return_value=process):
            with self.assertRaises(runtime.SpatialWorkerError) as error:
                runtime._run_model_process(Path(directory),Path(directory),Path(directory),180,lambda:True)
            self.assertEqual(error.exception.code,"worker_cancelled")
            process.kill.assert_called_once();process.wait.assert_called_once_with(timeout=5)


if __name__=="__main__":unittest.main()
