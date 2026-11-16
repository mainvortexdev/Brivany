"""Owned, off-screen WPF controls for UI Automation tests. Not a WhatsApp client."""
import json
import os
import sys
import threading


def main():
    from services.telephony.whatsapp_client_ui import desktop_reference
    for name in ('PresentationFramework','PresentationCore','WindowsBase'):
        desktop_reference(name)
    from System import Action
    from System.Threading import Thread, ThreadStart, ApartmentState
    from System.Windows import Application, Window, Thickness
    from System.Windows.Controls import StackPanel, TextBox, Button, TextBlock
    from System.Windows.Automation import AutomationProperties
    from System.Windows.Interop import WindowInteropHelper

    def run():
        app = Application()
        def stop():
            command = sys.stdin.readline().strip()
            if not command or command == 'stop ' + sys.argv[1]:
                app.Dispatcher.BeginInvoke(Action(app.Shutdown))
        threading.Thread(target=stop, daemon=True).start()
        window = Window(); window.Title = 'Brivany synthetic WhatsApp controls ' + sys.argv[1]
        window.Width = 320; window.Height = 180; window.Left = -10000; window.Top = -10000
        window.ShowInTaskbar = False
        panel = StackPanel(); window.Content = panel
        recipient = TextBox(); recipient.Text = '+1 (829) 555-0101'; recipient.IsReadOnly = True
        state = TextBlock(); state.Text = 'ready'
        call = Button(); call.Content = 'Voice call'
        hangup = Button(); hangup.Content = 'End call'
        hangup.IsEnabled = False
        for control, identity in ((recipient,'wa-recipient'),(state,'wa-state'),(call,'wa-call'),(hangup,'wa-hangup')):
            AutomationProperties.SetAutomationId(control, identity)
            panel.Children.Add(control)
        def connected(*_):
            state.Text = '00:01'; hangup.IsEnabled = True; call.IsEnabled = False
        def ended(*_):
            state.Text = 'ended'; hangup.IsEnabled = False; call.IsEnabled = True
        call.Click += connected
        hangup.Click += ended
        def ready(*_):
            print(json.dumps({'handle': WindowInteropHelper(window).Handle.ToInt64(), 'pid': os.getpid(), 'token': sys.argv[1]}), flush=True)
        window.Loaded += ready
        app.Run(window)
    thread = Thread(ThreadStart(run)); thread.SetApartmentState(ApartmentState.STA)
    thread.Start(); thread.Join()


if __name__ == '__main__':
    main()
