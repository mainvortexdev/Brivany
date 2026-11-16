"""Owned WinForms windows only; no WebView, keyboard injection or desktop capture."""
import ctypes
import json
from pathlib import Path
import tempfile
import sys
import threading
import time

import clr
clr.AddReference('System.Windows.Forms');clr.AddReference('System.Drawing')
from System import Action
from System.Drawing import Bitmap, Rectangle
from System.Drawing.Imaging import ImageFormat
from System.Threading import Thread, ThreadStart, ApartmentState
from System.Windows.Forms import Form, Application, ApplicationContext, Timer, Screen

from desktop.experience.desktop_widgets import DesktopWidgets
from desktop.experience.workspace_controls import process_resources

ROOT=Path(__file__).resolve().parents[1]


def main():
    measure='--measure' in sys.argv
    out=ROOT/'tmp/desktop-widgets-native';out.mkdir(parents=True,exist_ok=True)
    report={'passed':False,'mode':'real_owned_winforms_widgets_existing_dispatcher',
        'external_calls':0,'gpu_seconds':None,'webview_windows_created':0,'OS_input_sent':False,
        'personal_desktop_captured':False,'checks':[]}
    shared={};finished=threading.Event()
    def phase(value):
        report['phase']=value;(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    def ui():
        with tempfile.TemporaryDirectory(prefix='brivany-native-widgets-') as temp:
            context=ApplicationContext();root=Form();root.ShowInTaskbar=False;handle=root.Handle
            service=DesktopWidgets(Path(temp)/'state.json',dispatcher=lambda:root)
            driver=Timer();driver.Interval=20;stage=0;deadline=time.monotonic()+35;idle_at=0;idle_ticks=0;sample=None
            shared.update(root=root,context=context,service=service)
            user=ctypes.WinDLL('user32');user.GetForegroundWindow.restype=ctypes.c_void_p
            foreground=user.GetForegroundWindow()
            def finish():
                driver.Stop();driver.Dispose();service.close();root.Dispose();context.ExitThread();finished.set()
            def tick(*_):
                nonlocal stage,deadline,idle_at,idle_ticks,sample
                try:
                    assert time.monotonic()<deadline,'native trial deadline at '+report['phase']
                    if stage==0:
                        phase('lazy_service');assert service.host is None
                        service.connect({'note':'Nota sintetica propia.','timer':None},{},'workspace-panel');assert service.host is None
                        def open_windows():
                            for kind in ('clock','timer','notes'):service.open(kind)
                        threading.Thread(target=open_windows,daemon=True).start();stage=1
                    elif stage==1:
                        if not service.host or len(service.host.records)!=3:return
                        host=service.host;assert not host.error,host.error
                        assert host.metadata()['windows']==['clock','notes','timer']
                        assert user.GetForegroundWindow()==foreground,'Showing widgets stole foreground focus'
                        for kind,record in host.records.items():
                            form=record['form'];assert form.Visible and not form.ShowInTaskbar
                            assert Screen.FromControl(form).WorkingArea.Contains(form.Bounds)
                            prop=form.GetType().GetProperty('ShowWithoutActivation',__import__('System').Reflection.BindingFlags.Instance|__import__('System').Reflection.BindingFlags.NonPublic)
                            assert prop.GetValue(form,None) is True
                            bitmap=Bitmap(form.ClientSize.Width,form.ClientSize.Height)
                            try:form.DrawToBitmap(bitmap,Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(str(out/(kind+'.png')),ImageFormat.Png)
                            finally:bitmap.Dispose()
                        report['checks'].append('Three visible native widgets on the existing dispatcher; no focus steal, taskbar entry or off-screen bounds.')
                        assert host.metadata()['cadence']=='minute'
                        phase('native_note_and_conflict')
                        record=host.records['notes'];box=record['note'];old=record['note_revision']
                        service.model.update_note('Edicion remota sintetica.',old,'workspace-panel')
                        record['note_revision']=old;box.Text='Borrador nativo sintetico.'
                        assert service.model.snapshot()['note']=='Edicion remota sintetica.'
                        assert service.model.snapshot()['drafts']['native-notes']['text']=='Borrador nativo sintetico.'
                        assert record['reload'].Visible and record['save'].Visible
                        record['save'].PerformClick()
                        assert service.model.snapshot()['note']=='Borrador nativo sintetico.'
                        assert not record['reload'].Visible and not record['save'].Visible
                        box.Text='Linea propia.\r\n'*40
                        assert str(box.ScrollBars)=='Vertical'
                        box.Text='Borrador nativo sintetico.'
                        assert str(box.ScrollBars)=='None'
                        report['checks'].append('Native TextBox preserves concurrent drafts; explicit Save resolves them without silent overwrite.')
                        phase('native_timer_controls');service.model.timer_action('start',1600)
                        record=host.records['timer'];record['action'].PerformClick();assert service.model.snapshot()['timer']['state']=='paused'
                        record['action'].PerformClick();assert service.model.snapshot()['timer']['state']=='running'
                        assert host.metadata()['cadence']=='second';stage=2
                    elif stage==2:
                        if service.model.snapshot()['timer']['state']!='finished':return
                        host=service.host;assert host.records['timer']['value'].Text=='00:00'
                        assert service.model.alarm is None
                        report['checks'].append('Native pause/resume controls work; one real deadline completes and clears the alarm.')
                        phase('appearance_positions_and_closing')
                        before=service.model.snapshot();service.preferences({'theme':'soft','accent':'mint','size':'large'});service.settings(True)
                        for record in host.records.values():
                            assert record['form'].TopMost
                            assert Screen.FromControl(record['form']).WorkingArea.Contains(record['form'].Bounds)
                        note=host.records['notes'];note['form'].Location=host.net.Point(120,130)
                        assert service.model.snapshot()['positions']['notes']=={'x':120,'y':130}
                        service.close_windows();assert host.metadata()['windows']==[] and host.ticker is None
                        assert host.metadata()['cadence']=='stopped';idle_ticks=host.metadata()['render_ticks'];idle_at=time.monotonic();stage=3
                    elif stage==3:
                        if time.monotonic()-idle_at<1.2:return
                        host=service.host;assert host.metadata()['render_ticks']==idle_ticks and host.ticker is None
                        assert service.model.writer is None
                        service.open('notes');record=host.records['notes'];assert record['form'].Left==120 and record['form'].Top==130
                        assert record['note'].Text=='Borrador nativo sintetico.'
                        record['close'].PerformClick();assert not host.records
                        report['checks'].append('Appearance, TopMost, saved positions and note reopen work; closed widgets have no ticker and the save worker quiesces.')
                        if measure:
                            for kind in ('clock','timer','notes'):service.open(kind)
                            stage=4;driver.Interval=1500;phase('resource_warmup')
                        else:
                            service.close();assert service.model.closed and service.host.closed
                            report['passed']=True;phase('complete');finish()
                    elif stage==4:
                        sample=(time.perf_counter(),process_resources(),service.host.metadata()['render_ticks'])
                        stage=5;driver.Interval=3000;phase('measure_idle_three_widgets')
                    elif stage in (5,6,8):
                        current=process_resources();elapsed=time.perf_counter()-sample[0]
                        value={'duration_seconds':round(elapsed,3),'host_cpu_seconds':round(current['cpu_seconds']-sample[1]['cpu_seconds'],3),
                            'host_rss_before_bytes':sample[1]['rss_bytes'],'host_rss_after_bytes':current['rss_bytes'],
                            'widget_render_ticks':service.host.metadata()['render_ticks']-sample[2]}
                        report.setdefault('resource_samples',{})[{5:'idle_three_widgets',6:'running_timer',8:'all_widgets_closed'}[stage]]=value
                        if stage==5:
                            service.model.timer_action('start',8000);sample=(time.perf_counter(),process_resources(),service.host.metadata()['render_ticks'])
                            stage=6;phase('measure_running_timer')
                        elif stage==6:
                            service.model.timer_action('reset');service.close_windows();driver.Interval=1500;stage=7;phase('closed_warmup')
                        else:
                            assert service.host.ticker is None and not service.host.records
                            report['resource_scope']='isolated Python host with WinForms fixture; not all Brivany processes, WebView2 or a before/after application benchmark; one test timer wake per sample'
                            report['passed']=True;phase('complete');finish()
                    elif stage==7:
                        sample=(time.perf_counter(),process_resources(),service.host.metadata()['render_ticks'])
                        driver.Interval=3000;stage=8;phase('measure_all_widgets_closed')
                except Exception as error:
                    report['error']=type(error).__name__+': '+str(error);phase('failed');finish()
            driver.Tick+=tick;driver.Start();Application.Run(context)
    thread=Thread(ThreadStart(ui));thread.SetApartmentState(ApartmentState.STA);thread.IsBackground=True
    phase('starting_owned_dispatcher');thread.Start()
    if not finished.wait(40):
        phase('watchdog_timeout')
        root=shared.get('root')
        if root:
            def stop():
                shared['service'].close();shared['context'].ExitThread();root.Dispose()
            root.BeginInvoke(Action(stop))
        thread.Join(3000)
    else:thread.Join(3000)
    print(json.dumps(report,ensure_ascii=False));return 0 if report['passed'] else 1


if __name__=='__main__':raise SystemExit(main())
