cmake_minimum_required(VERSION 3.22.1)

# Set project name
project(BoldWallet)

# Force 16KB page size alignment for all native libraries
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wl,-z,max-page-size=0x4000")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wl,-z,max-page-size=0x4000")

# Set linker flags for 16KB alignment
set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} -Wl,-z,max-page-size=0x4000")
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -Wl,-z,max-page-size=0x4000")

# Global flags for all targets
set(CMAKE_C_FLAGS_INIT "-Wl,-z,max-page-size=0x4000")
set(CMAKE_CXX_FLAGS_INIT "-Wl,-z,max-page-size=0x4000")

# This CMakeLists.txt configures linker flags for 16KB alignment
# The actual native libraries are built by React Native and other modules
