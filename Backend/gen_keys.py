from py_vapid import Vapid
v = Vapid()
v.generate_keys()
print(f"PRIVATE: {v.private_key}")
print(f"PUBLIC: {v.public_key}")
