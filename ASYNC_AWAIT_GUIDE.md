# Async/Await Best Practices Guide

## **Why `async/await` is Better Than `.then().catch()`**

### **1. Readability (Most Important)**

#### ❌ **HARD TO READ (.then().catch())**
```javascript
useEffect(() => {
  client.get('/api/patients')
    .then(res => {
      if (res.success) {
        setPatients(res.data)
        return client.get('/api/doctors')
      }
    })
    .then(res => {
      if (res.success) {
        setDoctors(res.data)
      }
    })
    .catch(err => console.error(err))
}, [])
```

**Problems:**
- Pyramid of doom (multiple .then() chains)
- Hard to follow the flow
- Error handling is far from the code that failed
- Requires mental effort to understand

---

#### ✅ **EASY TO READ (async/await)**
```javascript
useEffect(() => {
  const loadData = async () => {
    try {
      const patientsRes = await client.get('/api/patients')
      if (patientsRes.success) {
        setPatients(patientsRes.data)
      }

      const doctorsRes = await client.get('/api/doctors')
      if (doctorsRes.success) {
        setDoctors(doctorsRes.data)
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    }
  }

  loadData()
}, [])
```

**Benefits:**
- Reads like synchronous code (top to bottom)
- Error handling right next to the error-prone code
- Variables are in the same scope
- Obvious when something fails

---

### **2. Error Handling**

#### ❌ **Silent Failures (.catch(() => {}))**
```javascript
client.get('/api/patients')
  .then(res => setPatients(res.data))
  .catch(() => {})  // ← Errors are hidden!
```

**What happens when it fails?**
- User sees nothing
- No error message
- No console log
- No debugging possible
- Patient records disappear with no explanation

---

#### ✅ **Clear Error Handling**
```javascript
try {
  const res = await client.get('/api/patients')
  setPatients(res.data)
} catch (err) {
  console.error('Failed to load patients:', err)
  toast.error('Could not load patients. Please refresh.')
}
```

**Benefits:**
- Errors are logged
- User gets feedback
- Easy to debug
- Can implement retry logic

---

### **3. Variable Scope**

#### ❌ **Lost in .then() Scope**
```javascript
let doctorId = null

client.get('/api/doctors')
  .then(res => {
    doctorId = res.data[0].id  // ← Set in .then()
  })
  .then(() => {
    console.log(doctorId)  // ← Works here
  })

console.log(doctorId)  // ← undefined here! (Wrong scope)
```

---

#### ✅ **Same Scope with async/await**
```javascript
const fetchDoctor = async () => {
  const res = await client.get('/api/doctors')
  const doctorId = res.data[0].id  // ← Same scope
  
  console.log(doctorId)  // ← Always works
  return doctorId
}

const id = await fetchDoctor()
console.log(id)  // ← Same scope, always works
```

---

### **4. Sequential vs Parallel Execution**

#### **Sequential (Wait for Each)**
```javascript
// GOOD when dependent on each other
const loadPatientDetails = async () => {
  try {
    // Step 1: Load patient
    const patientRes = await client.get(`/patients/${patientId}`)
    const patient = patientRes.data

    // Step 2: Load patient's records (depends on patient)
    const recordsRes = await client.get(`/patients/${patient.id}/records`)
    const records = recordsRes.data

    return { patient, records }
  } catch (err) {
    console.error('Failed to load patient details:', err)
  }
}
```

---

#### **Parallel (Simultaneous)**
```javascript
// GOOD when independent of each other
const loadData = async () => {
  try {
    // Load both at the same time (faster!)
    const [patientsRes, doctorsRes] = await Promise.all([
      client.get('/api/patients'),
      client.get('/api/doctors')
    ])

    setPatients(patientsRes.data)
    setDoctors(doctorsRes.data)
  } catch (err) {
    console.error('Failed to load data:', err)
  }
}
```

---

## **Before & After Examples**

### **Example 1: Loading Settings**

#### **BEFORE (Hard to Read)**
```javascript
useEffect(() => {
  client.get('/settings?resource=users')
    .then(res => { if (res.success) setDoctors((res.data ?? []).filter(u => u.role === 'doctor')) })
    .catch(() => {})
  client.get('/settings?resource=departments')
    .then(res => { if (res.success) setDepartments(res.data ?? []) })
    .catch(() => {})
}, [])
```

#### **AFTER (Clean & Clear)**
```javascript
useEffect(() => {
  const loadSettings = async () => {
    try {
      const doctorsRes = await client.get('/settings?resource=users')
      if (doctorsRes.success) {
        setDoctors((doctorsRes.data ?? []).filter(u => u.role === 'doctor'))
      }

      const deptsRes = await client.get('/settings?resource=departments')
      if (deptsRes.success) {
        setDepartments(deptsRes.data ?? [])
      }
    } catch (err) {
      console.error('Failed to load settings:', err)
      toast.error('Failed to load doctors and departments')
    }
  }

  loadSettings()
}, [])
```

---

### **Example 2: Delete with Confirmation**

#### **BEFORE**
```javascript
const handleDeletePatient = (patient) => {
  if (!window.confirm('Delete patient?')) return
  
  client.delete(`/patients/${patient.id}`)
    .then(res => {
      if (res.success) {
        toast.success('Patient deleted')
        fetchPatients()
      } else {
        toast.error(res.error || 'Failed to delete')
      }
    })
    .catch(err => {
      toast.error('Failed to delete patient')
    })
}
```

#### **AFTER**
```javascript
const handleDeletePatient = async (patient) => {
  if (!window.confirm('Delete patient?')) return

  try {
    const res = await client.delete(`/patients/${patient.id}`)
    if (res.success) {
      toast.success('Patient deleted')
      fetchPatients()
    } else {
      toast.error(res.error || 'Failed to delete')
    }
  } catch (err) {
    toast.error(err.message || 'Failed to delete patient')
  }
}
```

---

## **Key Rules**

### **✅ DO:**
- ✅ Use `async/await` instead of `.then().catch()`
- ✅ Always use `try/catch` blocks
- ✅ Log errors with context
- ✅ Show error messages to users
- ✅ Use `Promise.all()` for parallel operations
- ✅ Use `finally` only when cleanup is needed (close dialogs, reset spinners)

### **❌ DON'T:**
- ❌ Use `.catch(() => {})` (silent failures)
- ❌ Nest `.then()` chains (hard to read)
- ❌ Mix `.then()` and `async/await` in the same function
- ❌ Return promises without awaiting them
- ❌ Forget error handling

---

## **Pattern: useEffect with async/await**

### **Correct Pattern (Recommended)**
```javascript
useEffect(() => {
  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await client.get('/api/data')
      if (res.success) {
        setData(res.data)
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  fetchData()
}, [dependency])
```

### **Why This Works:**
1. Create async function inside useEffect
2. Call the function immediately
3. Error handling is clear
4. Loading state is properly managed
5. Cleanup happens automatically

---

## **Comparison Chart**

| Feature | .then() | async/await |
|---------|---------|------------|
| Readability | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Error Handling | Hard | Easy |
| Scope | Confusing | Clear |
| Debugging | Difficult | Simple |
| Variable Access | Limited | Full |
| Learning Curve | Steep | Gentle |
| Modern Standard | No | Yes (ES2017+) |

---

## **Summary**

**Use `async/await` with `try/catch` because:**

1. **Readability** - Reads like synchronous code
2. **Error Handling** - Errors right where they happen
3. **Scope** - Variables stay in the same scope
4. **Debugging** - Much easier to find and fix problems
5. **Maintainability** - Future developers understand code faster
6. **Modern Standard** - This is how professionals write JavaScript

**Status: All patient components have been refactored ✅**
