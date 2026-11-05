"""Native account methods. Credentials never return through public status."""
class AccountBridge:
    def account_status(self):self._trusted();return self._account_factory().status()
    def account_login(self,email,password,name=None):self._trusted();return self._account_factory().login(email,password,name)
    def account_logout(self):self._trusted();return self._account_factory().logout()
    def account_devices(self):self._trusted();return self._account_factory().devices()
    def account_command_status(self,identifier):self._trusted();return self._account_factory().command_status(identifier)
