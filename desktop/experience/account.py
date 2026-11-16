"""Native account methods. Credentials never return through public status."""
class AccountBridge:
    def demo_account_status(self):
        self._trusted()
        from services.demo_account import current
        account=current()
        return {'available':False} if account is None else {'available':True,**account.status()}
    def demo_account_refresh(self):
        self._trusted()
        from services.demo_account import current,DemoError
        account=current()
        if account is None:raise DemoError('Esta instalación no incluye una cuenta de demostración.')
        return {'available':True,**account.refresh()}
    def demo_telnyx_connect(self,api_key,from_number):
        self._trusted()
        from services.demo_account import current,DemoError
        account=current()
        if account is None:raise DemoError('Esta instalación no incluye una cuenta de demostración.')
        if not isinstance(api_key,str) or not 20<=len(api_key.strip())<=256:raise DemoError('Revisa la clave API de Telnyx.')
        from services.telephony.common import number
        return account.call('/v1/telnyx/connect',{'api_key':api_key.strip(),'from_number':number(from_number)})
    def demo_telnyx_status(self):
        self._trusted()
        from services.demo_account import current
        account=current()
        return {'configured':False} if account is None else account.call('/v1/telnyx/status')
    def account_status(self):self._trusted();return self._account_factory().status()
    def account_login(self,email,password,name=None):self._trusted();return self._account_factory().login(email,password,name)
    def account_logout(self):self._trusted();return self._account_factory().logout()
    def account_devices(self):self._trusted();return self._account_factory().devices()
    def account_command_status(self,identifier):self._trusted();return self._account_factory().command_status(identifier)
    def account_begin_login(self):self._trusted();return self._account_factory().begin()
    def account_cancel_login(self):self._trusted();return self._account_factory().cancel()
    def account_refresh(self):self._trusted();return self._account_factory().refresh()
    def account_manage(self,section='profile'):self._trusted();return self._account_factory().manage(section)
